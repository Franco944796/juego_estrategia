import type { LordView } from '@si/engine';
import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { estimateGameNow, useGame, type GameStore } from '../store';
import {
  centerFor,
  clampCenter,
  focusSpot,
  screenToWorld,
  startCamera,
  worldToScreen,
  zoomAt,
  type Camera,
  type Size,
  type Vec,
} from './camera';
import { drawScene, townRadiusPx } from './render';

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
    };
  }
}

function mapExtent(view: LordView): number {
  let extent = 0;
  for (const isle of view.isles) extent = Math.max(extent, Math.hypot(isle.pos.x, isle.pos.y) + isle.radius);
  return extent + MAP_MARGIN;
}

function hitTown(view: LordView, cam: Camera, size: Size, p: Vec): number | null {
  const reach = Math.max(TOUCH_RADIUS_PX, townRadiusPx(cam) + 6);
  let best: number | null = null;
  let bestDist = reach;
  for (const town of view.towns) {
    const s = worldToScreen(cam, size, town.pos);
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d <= bestDist) {
      best = town.id;
      bestDist = d;
    }
  }
  return best;
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
    const a = view.towns[s.send.from];
    const b = view.towns[s.send.to];
    return a && b ? { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 } : null;
  }
  return s.selected === null ? null : (view.towns[s.selected]?.pos ?? null);
}

function onTap(cam: Camera, size: Size, p: Vec): void {
  const store = useGame.getState();
  const view = store.view;
  if (!view) return;
  const townId = hitTown(view, cam, size, p);
  if (store.picking) {
    if (townId !== null && store.selected !== null && townId !== store.selected)
      store.openSend(store.selected, townId);
    return;
  }
  store.select(townId);
  if (store.tutorial === 0 && townId !== null && townId === view.me.capitalId) store.setTutorial(1);
}

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lang = useGame((s) => s.lang);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    let size: Size = { width: 1, height: 1 };
    let extent = 1000;
    // The camera is placed once per season; the map extent follows the map as it grows.
    let placedFor: number | null = null;
    let isleCount = 0;
    let raf = 0;
    let focus: Vec | null = null;

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      size = { width: canvas.clientWidth, height: canvas.clientHeight };
      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = (time: number): void => {
      const st = useGame.getState();
      const view = st.view;
      if (view) {
        if (placedFor !== view.season.startsAt) {
          extent = mapExtent(view);
          const capital = view.me.capitalId === null ? undefined : view.towns[view.me.capitalId];
          cam = startCamera(size, capital ? capital.pos : { x: 0, y: 0 }, extent);
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
        const highlight = st.tutorial === 0 ? view.me.capitalId : null;
        drawScene(ctx, {
          view,
          cam,
          size,
          time,
          gameNow: estimateGameNow(st.clock, view.season.endsAt),
          selected: st.selected,
          picking: st.picking,
          sendFrom: st.send?.from ?? null,
          highlight,
        });
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
        focus = clampCenter({ ...cam, ...centerFor(cam, size, point, spot) }, extent);
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
      const dx = c.x - gesture.start.x;
      const dy = c.y - gesture.start.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      let next: Camera = {
        ...gesture.cam,
        x: gesture.cam.x - dx / gesture.cam.zoom,
        y: gesture.cam.y - dy / gesture.cam.zoom,
      };
      if (gesture.pinch && pointers.size === 2) {
        const anchor = screenToWorld(gesture.cam, size, gesture.start);
        next = zoomAt({ ...gesture.cam }, size, gesture.start, spread() / gesture.pinch, extent);
        const shifted = worldToScreen(next, size, anchor);
        next = {
          ...next,
          x: next.x - (c.x - shifted.x) / next.zoom,
          y: next.y - (c.y - shifted.y) / next.zoom,
        };
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
        onTap(cam, size, local(e));
      }
      gesture =
        pointers.size > 0
          ? { start: center(), cam, at: performance.now(), moved: TAP_SLOP_PX + 1, pinch: null }
          : null;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      cam = clampCenter(zoomAt(cam, size, local(e), Math.exp(-e.deltaY * WHEEL_ZOOM), extent), extent);
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    window.__shatteredIsles = {
      townScreen: (id) => {
        const town = useGame.getState().view?.towns[id];
        if (!town) return null;
        const rect = canvas.getBoundingClientRect();
        const s = worldToScreen(cam, size, town.pos);
        return { x: s.x + rect.left, y: s.y + rect.top };
      },
      view: () => useGame.getState().view,
      cameraSettled: () => focus === null,
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
      delete window.__shatteredIsles;
    };
  }, []);

  return <canvas ref={canvasRef} className="map" role="img" aria-label={t(lang, 'map')} />;
}
