import type { LordView } from '@si/engine';
import { ownerColor } from '../ui/labels';

/** A town claims the ground closer to it than to any other town, up to this far. */
export const TERRITORY_RADIUS = 24;
/** Grid cell of the nearest-town search; a 3×3 block must reach past the radius and the border glow. */
const CELL = 40;
const FILL = 0.28;
/** The tint grows stronger this close to a border. */
const GLOW = 5;
const GLOW_ALPHA = 0.3;
const LINE = 1.3;
const LINE_SOFT = 1.4;
const EDGE_SOFT = 0.7;
const LINE_ALPHA = 0.9;
const LINE_DARKEN = 0.6;

interface Claim {
  x: number;
  z: number;
  /** Lord id, or '' for a neutral town (it claims ground but paints none). */
  owner: string;
}

export interface GroundArea {
  span: number;
  x0: number;
  z0: number;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Who holds the ground of one isle, painted on a canvas that covers the same square as its ground
 * texture: each lord's color over their towns' ground, stronger and with a line at the borders.
 */
export class Territory {
  readonly canvas = document.createElement('canvas');
  private key = '';

  constructor(
    private readonly area: GroundArea,
    private readonly isleId: number,
    size: number,
  ) {
    this.canvas.width = size;
    this.canvas.height = size;
  }

  /** Repaints only when an owner or a lord's color changed; true when it did. */
  update(view: LordView): boolean {
    const towns = view.towns.filter((t) => t.isleId === this.isleId);
    const key = towns.map((t) => `${t.id}:${t.owner ?? ''}`).join() + view.lords.map((l) => l.color).join();
    if (key === this.key) return false;
    this.key = key;
    this.paint(
      view,
      towns.map((t) => ({ x: t.pos.x, z: t.pos.y, owner: t.owner ?? '' })),
    );
    return true;
  }

  private paint(view: LordView, claims: Claim[]): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const size = this.canvas.width;
    const { span, x0, z0 } = this.area;
    const cols = Math.ceil(span / CELL) + 1;
    const grid: Claim[][] = Array.from({ length: cols * cols }, () => []);
    const cellOf = (v: number, v0: number): number =>
      Math.min(cols - 1, Math.max(0, Math.floor((v - v0) / CELL)));
    for (const c of claims) grid[cellOf(c.z, z0) * cols + cellOf(c.x, x0)]?.push(c);
    const colors = new Map(view.lords.map((l) => [l.id, rgb(ownerColor(view, l.id))]));
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const near: Claim[][] = [];
    for (let py = 0; py < size; py++) {
      const z = z0 + ((py + 0.5) / size) * span;
      const cz = cellOf(z, z0);
      for (let px = 0; px < size; px++) {
        const x = x0 + ((px + 0.5) / size) * span;
        const cx = cellOf(x, x0);
        near.length = 0;
        for (let gz = Math.max(0, cz - 1); gz <= Math.min(cols - 1, cz + 1); gz++) {
          for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++) {
            const list = grid[gz * cols + gx];
            if (list?.length) near.push(list);
          }
        }
        let a: Claim | null = null;
        let da = Infinity;
        for (const list of near) {
          for (const c of list) {
            const d = (c.x - x) ** 2 + (c.z - z) ** 2;
            if (d < da) {
              da = d;
              a = c;
            }
          }
        }
        if (!a || a.owner === '' || da > TERRITORY_RADIUS ** 2) continue;
        // Distance to the bisector with the nearest town of another owner.
        let border = TERRITORY_RADIUS - Math.sqrt(da);
        for (const list of near) {
          for (const c of list) {
            if (c.owner === a.owner) continue;
            const db = (c.x - x) ** 2 + (c.z - z) ** 2;
            const gap = Math.hypot(c.x - a.x, c.z - a.z) || 1;
            border = Math.min(border, (db - da) / (2 * gap));
          }
        }
        const color = colors.get(a.owner);
        if (!color) continue;
        const o = (py * size + px) * 4;
        // The line fades in over a pixel or two, so it stays smooth once the texture is stretched.
        const line = 1 - Math.min(1, Math.max(0, (border - LINE) / LINE_SOFT + 0.5));
        const glow = Math.max(0, 1 - border / GLOW);
        const fill = FILL + GLOW_ALPHA * glow * glow;
        const shade = 1 - (1 - LINE_DARKEN) * line;
        data[o] = color[0] * shade;
        data[o + 1] = color[1] * shade;
        data[o + 2] = color[2] * shade;
        // Soft outer edge too: the line ends where the territory does.
        const edge = Math.min(1, border / EDGE_SOFT);
        data[o + 3] = 255 * (fill + (LINE_ALPHA - fill) * line) * edge;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
}
