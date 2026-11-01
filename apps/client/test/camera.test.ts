import { describe, expect, it } from 'vitest';
import {
  centerFor,
  clampCenter,
  clampZoom,
  focusSpot,
  MAX_ZOOM,
  minZoom,
  screenToWorld,
  startCamera,
  worldToScreen,
  zoomAt,
} from '../src/map/camera';

const size = { width: 390, height: 844 };
const extent = 700;

describe('camera', () => {
  it('maps world to screen and back', () => {
    const cam = { x: 100, y: -50, zoom: 1.7 };
    const p = { x: 233, y: 97 };
    const back = screenToWorld(cam, size, worldToScreen(cam, size, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(worldToScreen(cam, size, { x: 100, y: -50 })).toEqual({ x: 195, y: 422 });
  });

  it('zooms around the pointer and within limits', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(cam, size, pointer);
    const zoomed = zoomAt(cam, size, pointer, 1.5, extent);
    const after = screenToWorld(zoomed, size, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(clampZoom(100, size, extent)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001, size, extent)).toBe(minZoom(size, extent));
  });

  it('keeps the center on the map and opens near the capital', () => {
    expect(clampCenter({ x: 3000, y: 4000, zoom: 1 }, 500)).toMatchObject({ x: 300, y: 400 });
    expect(clampCenter({ x: 10, y: 10, zoom: 1 }, 500)).toEqual({ x: 10, y: 10, zoom: 1 });
    const cam = startCamera(size, { x: 50, y: 60 }, extent);
    expect(cam).toMatchObject({ x: 50, y: 60 });
    expect(cam.zoom).toBeCloseTo(390 / 430, 9);
  });
});

describe('focus', () => {
  it('puts the focused point above the drawer on phones and left of it on desktop', () => {
    expect(focusSpot(size)).toEqual({ x: 195, y: 844 * 0.28 });
    expect(focusSpot(size, false)).toEqual({ x: 195, y: 422 });
    const wide = { width: 1280, height: 800 };
    expect(focusSpot(wide)).toEqual({ x: (1280 - 404) / 2, y: 400 });
    const cam = { x: 0, y: 0, zoom: 2 };
    const center = centerFor(cam, wide, { x: 50, y: -20 }, focusSpot(wide));
    const shown = worldToScreen({ ...cam, ...center }, wide, { x: 50, y: -20 });
    expect(shown.x).toBeCloseTo(focusSpot(wide).x, 9);
    expect(shown.y).toBeCloseTo(focusSpot(wide).y, 9);
    expect(startCamera(wide, { x: 0, y: 0 }, extent).zoom).toBeCloseTo(800 / 700, 9);
  });
});
