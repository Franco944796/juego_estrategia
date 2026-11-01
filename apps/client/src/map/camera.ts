export interface Vec {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM_FACTOR = 0.8;
export const MAX_ZOOM = 3;
/** World units shown across the short side of the screen when a game opens. */
export const START_SPAN = 430;
export const START_SPAN_WIDE = 700;
/** Same breakpoint as the desktop layout in styles.css. */
export const WIDE_SCREEN = 900;
/** Width the desktop side drawer takes from the map, margins included. */
export const DRAWER_WIDTH = 404;
const FOCUS_HEIGHT_NARROW = 0.28;

export function worldToScreen(cam: Camera, size: Size, p: Vec): Vec {
  return { x: (p.x - cam.x) * cam.zoom + size.width / 2, y: (p.y - cam.y) * cam.zoom + size.height / 2 };
}

export function screenToWorld(cam: Camera, size: Size, p: Vec): Vec {
  return { x: (p.x - size.width / 2) / cam.zoom + cam.x, y: (p.y - size.height / 2) / cam.zoom + cam.y };
}

/** Smallest zoom that still shows the whole map (radius `extent`) with some margin. */
export function minZoom(size: Size, extent: number): number {
  return (Math.min(size.width, size.height) / (2 * extent)) * MIN_ZOOM_FACTOR;
}

export function clampZoom(zoom: number, size: Size, extent: number): number {
  return Math.min(MAX_ZOOM, Math.max(minZoom(size, extent), zoom));
}

/** Zooms by `factor` keeping the world point under `screen` fixed. */
export function zoomAt(cam: Camera, size: Size, screen: Vec, factor: number, extent: number): Camera {
  const anchor = screenToWorld(cam, size, screen);
  const zoom = clampZoom(cam.zoom * factor, size, extent);
  return {
    zoom,
    x: anchor.x - (screen.x - size.width / 2) / zoom,
    y: anchor.y - (screen.y - size.height / 2) / zoom,
  };
}

/** Keeps the camera center inside the map. */
export function clampCenter(cam: Camera, extent: number): Camera {
  const d = Math.hypot(cam.x, cam.y);
  if (d <= extent) return cam;
  return { ...cam, x: (cam.x / d) * extent, y: (cam.y / d) * extent };
}

export function startCamera(size: Size, center: Vec, extent: number): Camera {
  const span = size.width >= WIDE_SCREEN ? START_SPAN_WIDE : START_SPAN;
  return {
    x: center.x,
    y: center.y,
    zoom: clampZoom(Math.min(size.width, size.height) / span, size, extent),
  };
}

/** Screen point where a focused town should sit so the drawer (when open) does not cover it. */
export function focusSpot(size: Size, drawerOpen = true): Vec {
  if (!drawerOpen) return { x: size.width / 2, y: size.height / 2 };
  if (size.width >= WIDE_SCREEN) return { x: (size.width - DRAWER_WIDTH) / 2, y: size.height / 2 };
  return { x: size.width / 2, y: size.height * FOCUS_HEIGHT_NARROW };
}

/** Camera center that shows world point `p` at screen point `spot`, at the current zoom. */
export function centerFor(cam: Camera, size: Size, p: Vec, spot: Vec): Vec {
  return { x: p.x - (spot.x - size.width / 2) / cam.zoom, y: p.y - (spot.y - size.height / 2) / cam.zoom };
}
