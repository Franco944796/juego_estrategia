import type { LordView } from '@si/engine';
import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { tiltedProjector } from '../map3d/camera3d';
import { drawOverlay } from '../map3d/overlay3d';
import { World3D } from '../map3d/world3d';
import { estimateGameNow, useGame, type GameStore } from '../store';
import { townById } from '../ui/labels';
import { clampCenter, focusSpot, startCamera, type Camera, type Size, type Vec } from './camera';
import { flatProjector, type Projector } from './projector';
import { drawScene, targetsFrom, townRadiusPx } from './render';

const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 500;
const TOUCH_RADIUS_PX = 22;
const WHEEL_ZOOM = 0.0015;
const MAP_MARGIN = 120;
/** Share of the remaining distance the camera covers each frame when it pans to a focus. */
const FOCUS_EASE = 0.22;
const FOCUS_DONE = 0.5;

declare global {
  interface Window {
    /** Read-only hooks for the end-to-end tests. */
    __shatteredIsles?: {
      townScreen(id: number): Vec | null;
      view(): LordView | null;
      cameraSettled(): boolean;
      /** Pans (animated) until the town sits in the middle of the screen. */
      centerOn(id: number): void;
    };
  }
}

/** What draws the map: the flat 2D canvas or the 3D scene with its label layer. */
interface Painter {
  projector: Projector;
  /** Height at which a town is tapped and pointed at (its model's middle in 3D). */
  townHeight(level: number): number;
  resize(size: Size, dpr: number): void;
  draw(st: GameStore, view: LordView, cam: Camera, size: Size, time: number): void;
  dispose(): void;
}

function mapExtent(view: LordView): number {
  let extent = 0;
  for (const isle of view.isles) extent = Math.max(extent, Math.hypot(isle.pos.x, isle.pos.y) + isle.radius);
  return extent + MAP_MARGIN;
}

function flatPainter(canvas: HTMLCanvasElement): Painter | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return {
    projector: flatProjector,
    townHeight: () => 0,
    resize: (size, dpr) => {
      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw: (st, view, cam, size, time) =>
      drawScene(ctx, {
        view,
        cam,
        size,
        time,
        gameNow: estimateGameNow(st.clock, view.season.endsAt),
        selected: st.selected,
        picking: st.picking,
        sendFrom: st.send?.from ?? null,
        highlight: st.tutorial === 0 ? view.me.capitalId : null,
      }),
    dispose: () => undefined,
  };
}

/** Null when the browser has no WebGL; the map then falls back to 2D. */
function tiltedPainter(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement): Painter | null {
  const ctx = overlay.getContext('2d');
  if (!ctx) return null;
  let world: World3D;
  try {
    world = new World3D(canvas);
  } catch {
    return null;
  }
  const top = (level: number): number => world.modelHeight(level);
  return {
    projector: tiltedProjector,
    townHeight: (level) => top(level) * 0.4,
    resize: (size, dpr) => {
      world.setSize(size);
      overlay.width = Math.round(size.width * dpr);
      overlay.height = Math.round(size.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw: (st, view, cam, size, time) => {
      const source = st.picking && st.selected !== null ? townById(view, st.selected) : undefined;
      const input = {
        view,
        cam,
        size,
        time,
        gameNow: estimateGameNow(st.clock, view.season.endsAt),
        selected: st.selected,
        sendFrom: st.send?.from ?? null,
        highlight: st.tutorial === 0 ? view.me.capitalId : null,
        targets: source ? targetsFrom(view, source) : null,
      };
      world.render(input);
      drawOverlay(ctx, input, top, (level) => world.modelRadius(level));
    },
    dispose: () => world.dispose(),
  };
}

/** What the drawer is about: the send route or the selected town. */
function focusKey(s: GameStore): string | null {
  if (s.send) return `send:${s.send.from}:${s.send.to}`;
  if (s.selected === null) return null;
  // While picking a target the drawer is closed, so the source goes to the middle of the screen.
  return s.picking ? `pick:${s.selected}` : `town:${s.selected}`;
}

function focusPoint(s: GameStore): Vec | null {
  const view = s.view;
  if (!view) return null;
  if (s.send) {
    const a = townById(view, s.send.from);
    const b = townById(view, s.send.to);
    return a && b ? { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 } : null;
  }
  return s.selected === null ? null : (townById(view, s.selected)?.pos ?? null);
}

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const lang = useGame((s) => s.lang);
  const mode = useGame((s) => s.mapMode);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const painter = mode === '3d' ? tiltedPainter(canvas, overlay) : flatPainter(canvas);
    if (!painter) {
      if (mode === '3d') useGame.getState().setMapMode('2d');
      return;
    }
    const { projector } = painter;
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    let size: Size = { width: 1, height: 1 };
    let extent = 1000;
    // The camera is placed once per season; the map extent follows the map as it grows.
    let placedFor: number | null = null;
    let isleCount = 0;
    let raf = 0;
    let focus: Vec | null = null;

    const resize = (): void => {
      size = { width: canvas.clientWidth, height: canvas.clientHeight };
      painter.resize(size, window.devicePixelRatio || 1);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const screenOf = (view: LordView, townId: number): Vec | null => {
      const town = townById(view, townId);
      return town ? projector.toScreen(cam, size, town.pos, painter.townHeight(town.tier)) : null;
    };

    const hitTown = (view: LordView, p: Vec): number | null => {
      const reach = Math.max(TOUCH_RADIUS_PX, townRadiusPx(cam) + 6);
      let best: number | null = null;
      let bestDist = reach;
      for (const town of view.towns) {
        const s = projector.toScreen(cam, size, town.pos, painter.townHeight(town.tier));
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d <= bestDist) {
          best = town.id;
          bestDist = d;
        }
      }
      return best;
    };

    const onTap = (p: Vec): void => {
      const store = useGame.getState();
      const view = store.view;
      if (!view) return;
      const townId = hitTown(view, p);
      if (store.picking) {
        if (townId !== null && store.selected !== null && townId !== store.selected)
          store.openSend(store.selected, townId);
        return;
      }
      store.select(townId);
      if (store.tutorial === 0 && townId !== null && townId === view.me.capitalId) store.setTutorial(1);
    };

    const frame = (time: number): void => {
      const st = useGame.getState();
      const view = st.view;
      if (view) {
        if (placedFor !== view.season.startsAt) {
          extent = mapExtent(view);
          const capital = townById(view, view.me.capitalId);
          const center = capital ? capital.pos : { x: 0, y: 0 };
          cam = startCamera(size, center, extent, projector.startCloser, projector.maxZoom);
          placedFor = view.season.startsAt;
          isleCount = view.isles.length;
        } else if (view.isles.length !== isleCount) {
          extent = mapExtent(view);
          isleCount = view.isles.length;
        }
        if (focus) {
          cam = {
            ...cam,
            x: cam.x + (focus.x - cam.x) * FOCUS_EASE,
            y: cam.y + (focus.y - cam.y) * FOCUS_EASE,
          };
          if (Math.hypot(focus.x - cam.x, focus.y - cam.y) < FOCUS_DONE) focus = null;
        }
        painter.draw(st, view, cam, size, time);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const unsubscribe = useGame.subscribe((s, prev) => {
      const key = focusKey(s);
      if (key === null || key === focusKey(prev)) return;
      const point = focusPoint(s);
      if (point) {
        const spot = focusSpot(size, !s.picking);
        focus = clampCenter({ ...cam, ...projector.centerFor(cam, size, point, spot) }, extent);
      }
    });

    const pointers = new Map<number, Vec>();
    let gesture: { start: Vec; cam: Camera; at: number; moved: number; pinch: number | null } | null = null;
    const local = (e: PointerEvent | WheelEvent): Vec => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const spread = (): number => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const center = (): Vec => {
      const pts = [...pointers.values()];
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      };
    };
    /** Moves `next` so the ground point under `screen` with the gesture's camera stays under the finger. */
    const keepUnder = (next: Camera, from: Camera, start: Vec, screen: Vec): Camera => {
      const anchor = projector.toWorld(from, size, start);
      const now = projector.toWorld(next, size, screen);
      return { ...next, x: next.x + anchor.x - now.x, y: next.y + anchor.y - now.y };
    };

    const down = (e: PointerEvent): void => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      focus = null;
      gesture = {
        start: center(),
        cam,
        at: performance.now(),
        moved: 0,
        pinch: pointers.size === 2 ? spread() : null,
      };
    };
    const move = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, local(e));
      const c = center();
      gesture.moved = Math.max(gesture.moved, Math.hypot(c.x - gesture.start.x, c.y - gesture.start.y));
      let next = keepUnder(gesture.cam, gesture.cam, gesture.start, c);
      if (gesture.pinch && pointers.size === 2) {
        const zoomed = projector.zoomAt(gesture.cam, size, gesture.start, spread() / gesture.pinch, extent);
        next = keepUnder(zoomed, gesture.cam, gesture.start, c);
        gesture.moved = Math.max(gesture.moved, TAP_SLOP_PX + 1);
      }
      cam = clampCenter(next, extent);
    };
    const up = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (
        gesture &&
        wasSingle &&
        gesture.moved < TAP_SLOP_PX &&
        performance.now() - gesture.at < TAP_MAX_MS
      ) {
        onTap(local(e));
      }
      gesture =
        pointers.size > 0
          ? { start: center(), cam, at: performance.now(), moved: TAP_SLOP_PX + 1, pinch: null }
          : null;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      cam = clampCenter(
        projector.zoomAt(cam, size, local(e), Math.exp(-e.deltaY * WHEEL_ZOOM), extent),
        extent,
      );
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    window.__shatteredIsles = {
      townScreen: (id) => {
        const current = useGame.getState().view;
        const s = current ? screenOf(current, id) : null;
        if (!s) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: s.x + rect.left, y: s.y + rect.top };
      },
      view: () => useGame.getState().view,
      cameraSettled: () => focus === null,
      centerOn: (id) => {
        const current = useGame.getState().view;
        const town = current ? townById(current, id) : undefined;
        if (!town) return;
        const middle = { x: size.width / 2, y: size.height * 0.45 };
        focus = clampCenter({ ...cam, ...projector.centerFor(cam, size, town.pos, middle) }, extent);
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      painter.dispose();
      delete window.__shatteredIsles;
    };
  }, [mode]);

  // A WebGL canvas cannot go back to 2D, so each mode gets a fresh canvas.
  return (
    <>
      <canvas key={mode} ref={canvasRef} className="map" role="img" aria-label={t(lang, 'map')} />
      <canvas ref={overlayRef} className="map map-overlay" aria-hidden="true" hidden={mode !== '3d'} />
    </>
  );
}
