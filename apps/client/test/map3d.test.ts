import { describe, expect, it } from 'vitest';
import { tiltedProjector, toGround3d, toScreen3d } from '../src/map3d/camera3d';
import { buildStages, STAGE_FROM, stageFor } from '../src/map3d/models';

const size = { width: 390, height: 844 };
const cam = { x: 100, y: -40, zoom: 2 };

describe('tilted camera', () => {
  it('turns a ground point into a screen point and back', () => {
    for (const p of [
      { x: 100, y: -40 },
      { x: 160, y: 10 },
      { x: 60, y: -120 },
    ]) {
      const s = toScreen3d(cam, size, p);
      const back = toGround3d(cam, size, s);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    const center = toScreen3d(cam, size, { x: cam.x, y: cam.y });
    expect(center.x).toBeCloseTo(size.width / 2, 6);
    expect(center.y).toBeCloseTo(size.height / 2, 6);
  });

  it('keeps zoom as screen pixels per world unit at the point looked at', () => {
    const a = toScreen3d(cam, size, { x: cam.x, y: cam.y });
    const b = toScreen3d(cam, size, { x: cam.x + 10, y: cam.y });
    expect(b.x - a.x).toBeCloseTo(10 * cam.zoom, 1);
  });

  it('draws higher points higher on screen', () => {
    const ground = toScreen3d(cam, size, { x: cam.x, y: cam.y });
    const top = toScreen3d(cam, size, { x: cam.x, y: cam.y }, 10);
    expect(top.y).toBeLessThan(ground.y);
  });

  it('zooms around the finger and centers a point where asked', () => {
    const finger = { x: 300, y: 600 };
    const under = toGround3d(cam, size, finger);
    const zoomed = tiltedProjector.zoomAt(cam, size, finger, 1.8, 10_000);
    expect(zoomed.zoom).toBeCloseTo(3.6, 9);
    const still = toGround3d(zoomed, size, finger);
    expect(still.x).toBeCloseTo(under.x, 4);
    expect(still.y).toBeCloseTo(under.y, 4);
    const spot = { x: 195, y: 236 };
    const target = { x: 130, y: 20 };
    const moved = { ...cam, ...tiltedProjector.centerFor(cam, size, target, spot) };
    const seen = toScreen3d(moved, size, target);
    expect(seen.x).toBeCloseTo(spot.x, 4);
    expect(seen.y).toBeCloseTo(spot.y, 4);
    expect(tiltedProjector.zoomAt(cam, size, finger, 100, 10_000).zoom).toBe(tiltedProjector.maxZoom);
  });
});

describe('town models', () => {
  it('picks the stage by level: hut, house, village, fort, citadel and castle at 100', () => {
    expect([1, 9, 10, 29, 30, 59, 60, 89, 90, 99, 100].map(stageFor)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5,
    ]);
    expect(STAGE_FROM).toHaveLength(6);
  });

  it('builds six models that grow taller and wider, each with a part for the owner color', () => {
    const stages = buildStages();
    expect(stages).toHaveLength(6);
    for (const m of stages) {
      expect(m.fixed.getAttribute('color')).toBeDefined();
      expect(m.team.getAttribute('position').count).toBeGreaterThan(0);
    }
    const heights = stages.map((m) => m.height);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(stages[5]?.radius ?? 0).toBeGreaterThan(stages[0]?.radius ?? 0);
  });
});
