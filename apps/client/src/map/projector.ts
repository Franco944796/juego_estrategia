import {
  centerFor,
  MAX_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Camera,
  type Size,
  type Vec,
} from './camera';

/** How a map view turns world points into screen points and back; the gestures only use this. */
export interface Projector {
  /** Opening zoom relative to the 2D map, and the closest zoom allowed. */
  startCloser: number;
  maxZoom: number;
  /** `height` lifts the point off the ground (3D only). */
  toScreen(cam: Camera, size: Size, p: Vec, height?: number): Vec;
  /** The ground point under a screen point. */
  toWorld(cam: Camera, size: Size, s: Vec): Vec;
  zoomAt(cam: Camera, size: Size, screen: Vec, factor: number, extent: number): Camera;
  centerFor(cam: Camera, size: Size, p: Vec, spot: Vec): Vec;
}

export const flatProjector: Projector = {
  startCloser: 1,
  maxZoom: MAX_ZOOM,
  toScreen: (cam, size, p) => worldToScreen(cam, size, p),
  toWorld: screenToWorld,
  zoomAt,
  centerFor,
};
