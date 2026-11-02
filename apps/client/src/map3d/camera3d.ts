import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { clampZoom, type Camera, type Size, type Vec } from '../map/camera';
import type { Projector } from '../map/projector';

/** Angle between the line of sight and the ground: a tilted, tabletop view. */
export const TILT = MathUtils.degToRad(40);
export const FOV = 35;
/** Close enough to see a castle's battlements; the 3D map also opens nearer than the 2D one. */
const MAX_ZOOM_3D = 8;
const START_CLOSER_3D = 2.4;

const scratch = new PerspectiveCamera();
/** The scratch camera is only re-placed when the view changes (labels project hundreds of points). */
let scratchKey = '';
const ground = new Plane(new Vector3(0, 1, 0), 0);
const ray = new Raycaster();
const hit = new Vector3();
const point = new Vector3();

/**
 * Places a perspective camera for the 2D camera state: it looks at (x, 0, y) from the south, and
 * `zoom` keeps its 2D meaning (screen pixels per world unit at the point looked at).
 */
export function placeCamera(cam: Camera, size: Size, camera: PerspectiveCamera = scratch): PerspectiveCamera {
  if (camera === scratch) {
    const key = `${cam.x},${cam.y},${cam.zoom},${size.width},${size.height}`;
    if (key === scratchKey) return camera;
    scratchKey = key;
  }
  const distance = size.height / (2 * cam.zoom * Math.tan(MathUtils.degToRad(FOV) / 2));
  camera.fov = FOV;
  camera.aspect = size.width / Math.max(1, size.height);
  camera.near = Math.max(1, distance * 0.05);
  camera.far = distance * 20 + 5000;
  camera.position.set(cam.x, Math.sin(TILT) * distance, cam.y + Math.cos(TILT) * distance);
  camera.lookAt(cam.x, 0, cam.y);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

export function toScreen3d(cam: Camera, size: Size, p: Vec, height = 0): Vec {
  point.set(p.x, height, p.y).project(placeCamera(cam, size));
  return { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height };
}

export function toGround3d(cam: Camera, size: Size, s: Vec): Vec {
  const ndc = new Vector2((s.x / size.width) * 2 - 1, 1 - (s.y / size.height) * 2);
  ray.setFromCamera(ndc, placeCamera(cam, size));
  // The tilt keeps every ray on screen pointing down at the ground.
  if (!ray.ray.intersectPlane(ground, hit)) return { x: cam.x, y: cam.y };
  return { x: hit.x, y: hit.z };
}

export const tiltedProjector: Projector = {
  startCloser: START_CLOSER_3D,
  maxZoom: MAX_ZOOM_3D,
  toScreen: toScreen3d,
  toWorld: toGround3d,
  zoomAt: (cam, size, screen, factor, extent) => {
    const before = toGround3d(cam, size, screen);
    const next = { ...cam, zoom: clampZoom(cam.zoom * factor, size, extent, MAX_ZOOM_3D) };
    const after = toGround3d(next, size, screen);
    return { ...next, x: cam.x + before.x - after.x, y: cam.y + before.y - after.y };
  },
  centerFor: (cam, size, p, spot) => {
    const under = toGround3d(cam, size, spot);
    return { x: cam.x + p.x - under.x, y: cam.y + p.y - under.y };
  },
};
