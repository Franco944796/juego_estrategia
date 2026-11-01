import { defaultConfig } from '@si/config';
import {
  totalTroops,
  WIND_VECTORS,
  windFactor,
  type LordView,
  type TownView,
  type TroopType,
} from '@si/engine';
import { formatNumber } from '../format';
import { HUMAN_ID } from '../game/protocol';
import { linkedIsles, NEUTRAL_COLOR, ownerColor } from '../ui/labels';
import { worldToScreen, type Camera, type Size, type Vec } from './camera';

export interface SceneInput {
  view: LordView;
  cam: Camera;
  size: Size;
  /** Animation clock in real milliseconds. */
  time: number;
  gameNow: number;
  selected: number | null;
  picking: boolean;
  sendFrom: number | null;
  highlight: number | null;
}

export const TOWN_RADIUS = 12;
const MIN_TOWN_PX = 9;
const LABEL_MIN_PX = 10;
const STREAKS = 40;
const STREAK_SPEED = 0.05;
const INK = '#0d1b2a';
const GOLD = '#ffd166';
const HOSTILE = '#ff4d4d';

export function townRadiusPx(cam: Camera): number {
  return Math.max(MIN_TOWN_PX, TOWN_RADIUS * cam.zoom);
}

/** Lane colors by the wind factor of a trip along them. */
export function windColor(factor: number): string {
  if (factor >= 1.35) return '#7bd88f';
  if (factor <= 0.75) return '#ff6b6b';
  return GOLD;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function circle(ctx: CanvasRenderingContext2D, p: Vec, r: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color = '#ffffff',
): void {
  ctx.font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8, 16, 32, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function sky(ctx: CanvasRenderingContext2D, size: Size): void {
  const g = ctx.createLinearGradient(0, 0, 0, size.height);
  g.addColorStop(0, '#0b1734');
  g.addColorStop(0.55, '#1d3f6e');
  g.addColorStop(1, '#3a6ea5');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size.width, size.height);
}

function windStreaks(ctx: CanvasRenderingContext2D, input: SceneInput): void {
  const w = WIND_VECTORS[input.view.wind.dir];
  if (!w) return;
  const margin = 60;
  const width = input.size.width + margin * 2;
  const height = input.size.height + margin * 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < STREAKS; i++) {
    const travel = input.time * STREAK_SPEED * (0.6 + fract(i * 0.618));
    const x = mod(fract(Math.sin(i * 12.9898) * 43758.5453) * width + w.x * travel, width) - margin;
    const y = mod(fract(Math.sin(i * 78.233) * 24634.6345) * height + w.y * travel, height) - margin;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - w.x * 26, y - w.y * 26);
    ctx.stroke();
  }
}

function islePath(ctx: CanvasRenderingContext2D, c: Vec, r: number, shape: number[]): void {
  const n = shape.length;
  const pts = shape.map((k, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * r * k, y: c.y + Math.sin(a) * r * k };
  });
  const mid = (p: Vec, q: Vec): Vec => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const last = pts[n - 1] as Vec;
  const first = pts[0] as Vec;
  const start = mid(last, first);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  pts.forEach((p, i) => {
    const m = mid(p, pts[(i + 1) % n] as Vec);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  });
  ctx.closePath();
}

function lanes(ctx: CanvasRenderingContext2D, input: SceneInput, sourceIsle: number | null): void {
  const { view, cam, size } = input;
  for (const lane of view.lanes) {
    const a = view.isles[lane.a];
    const b = view.isles[lane.b];
    if (!a || !b) continue;
    const pa = worldToScreen(cam, size, a.pos);
    const pb = worldToScreen(cam, size, b.pos);
    let color = 'rgba(220, 235, 255, 0.22)';
    let width = 1.5;
    let factor: number | null = null;
    if (sourceIsle !== null && (lane.a === sourceIsle || lane.b === sourceIsle)) {
      const [src, dst] = lane.a === sourceIsle ? [a, b] : [b, a];
      factor = windFactor(
        src.pos,
        dst.pos,
        view.wind.dir,
        defaultConfig.wind.tailwindMax,
        defaultConfig.wind.headwindMin,
      );
      color = windColor(factor);
      width = 3;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (factor !== null) label(ctx, `×${factor.toFixed(1)}`, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 13, color);
  }
}

function isles(ctx: CanvasRenderingContext2D, input: SceneInput): void {
  const { view, cam, size, time } = input;
  for (const isle of view.isles) {
    const c = worldToScreen(cam, size, isle.pos);
    const r = isle.radius * cam.zoom;
    if (c.x < -r * 2 || c.y < -r * 2 || c.x > size.width + r * 2 || c.y > size.height + r * 2) continue;
    islePath(ctx, { x: c.x, y: c.y + r * 0.34 }, r * 0.86, isle.shape);
    ctx.fillStyle = '#4f3b2c';
    ctx.fill();
    islePath(ctx, c, r, isle.shape);
    ctx.fillStyle = isle.ring === 0 ? '#9d86cf' : '#5b8f3e';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isle.ring === 0 ? '#3f2f6b' : '#2c4a1d';
    ctx.stroke();
    if (!isle.hasBeacon) continue;
    const bx = c.x + r * 0.7;
    const by = c.y - r * 0.62;
    ctx.strokeStyle = '#2b2118';
    ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(bx, by + r * 0.22);
    ctx.lineTo(bx, by);
    ctx.stroke();
    circle(ctx, { x: bx, y: by }, Math.max(3, r * 0.07));
    if (isle.beaconOwner) {
      ctx.save();
      ctx.shadowColor = ownerColor(view, isle.beaconOwner);
      ctx.shadowBlur = 12 + Math.sin(time / 300) * 4;
      ctx.fillStyle = ownerColor(view, isle.beaconOwner);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = '#6b6b6b';
      ctx.fill();
    }
  }
}

function marches(ctx: CanvasRenderingContext2D, input: SceneInput): void {
  const { view, cam, size, time, gameNow } = input;
  for (const m of view.marches) {
    const from = view.towns[m.from];
    const to = view.towns[m.to];
    if (!from || !to) continue;
    const span = Math.max(1, m.arriveAt - m.departAt);
    const progress = Math.min(1, Math.max(0, (gameNow - m.departAt) / span));
    const a = worldToScreen(cam, size, from.pos);
    const b = worldToScreen(cam, size, to.pos);
    const cur = { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
    const color = m.incoming ? HOSTILE : ownerColor(view, m.owner);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(cur.x, cur.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const s = 9;
    ctx.save();
    ctx.translate(cur.x, cur.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, s * 0.65);
    ctx.lineTo(-s * 0.35, 0);
    ctx.lineTo(-s * 0.7, -s * 0.65);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
    if (m.troops)
      label(
        ctx,
        formatNumber(totalTroops(m.troops)),
        cur.x,
        cur.y - 14,
        11,
        m.incoming ? HOSTILE : '#ffffff',
      );
    if (m.incoming) {
      ctx.strokeStyle = HOSTILE;
      ctx.lineWidth = 2;
      circle(ctx, b, townRadiusPx(cam) + 8 + Math.sin(time / 160) * 3);
      ctx.stroke();
    }
  }
}

function glyph(ctx: CanvasRenderingContext2D, spec: TroopType, p: Vec, s: number): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1.5, s * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (spec === 'LANCER') {
    ctx.moveTo(0, s);
    ctx.lineTo(0, -s * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.38, -s * 0.3);
    ctx.lineTo(-s * 0.38, -s * 0.3);
    ctx.closePath();
    ctx.fill();
  } else if (spec === 'ARCHER') {
    ctx.arc(-s * 0.35, 0, s * 0.95, -Math.PI / 3, Math.PI / 3);
    ctx.moveTo(-s * 0.35 + s * 0.95 * Math.cos(Math.PI / 3), -s * 0.95 * Math.sin(Math.PI / 3));
    ctx.lineTo(-s * 0.35 + s * 0.95 * Math.cos(Math.PI / 3), s * 0.95 * Math.sin(Math.PI / 3));
    ctx.stroke();
  } else {
    ctx.moveTo(-s, -s * 0.15);
    ctx.quadraticCurveTo(-s * 0.45, -s * 0.95, 0, s * 0.4);
    ctx.quadraticCurveTo(s * 0.45, -s * 0.95, s, -s * 0.15);
    ctx.stroke();
  }
  ctx.restore();
}

function crown(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.5);
  ctx.lineTo(cx - s, cy - s * 0.45);
  ctx.lineTo(cx - s * 0.45, cy);
  ctx.lineTo(cx, cy - s * 0.7);
  ctx.lineTo(cx + s * 0.45, cy);
  ctx.lineTo(cx + s, cy - s * 0.45);
  ctx.lineTo(cx + s, cy + s * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function lock(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.lineWidth = Math.max(2, s * 0.25);
  ctx.strokeStyle = '#e8e8f0';
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.3, s * 0.45, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#e8e8f0';
  ctx.fillRect(cx - s * 0.7, cy - s * 0.3, s * 1.4, s * 1.05);
}

function towns(ctx: CanvasRenderingContext2D, input: SceneInput, targets: Set<number> | null): void {
  const { view, cam, size, time } = input;
  const r = townRadiusPx(cam);
  for (const town of view.towns) {
    const p = worldToScreen(cam, size, town.pos);
    if (p.x < -40 || p.y < -40 || p.x > size.width + 40 || p.y > size.height + 40) continue;
    const rr = town.isThrone ? r * 1.35 : r;
    circle(ctx, { x: p.x + 1.5, y: p.y + 2.5 }, rr);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    circle(ctx, p, rr);
    ctx.fillStyle = town.owner === null ? NEUTRAL_COLOR : ownerColor(view, town.owner);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (town.owner === HUMAN_ID) {
      circle(ctx, p, rr + 3);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    glyph(ctx, town.spec, p, rr * 0.55);
    for (let i = 0; i < town.tier; i++) {
      circle(ctx, { x: p.x + (i - (town.tier - 1) / 2) * 5.5, y: p.y + rr + 5 }, 1.9);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    if (town.isCapital) crown(ctx, p.x, p.y - rr - 6, rr * 0.5, GOLD);
    if (town.isThrone) {
      crown(ctx, p.x, p.y - rr - 8, rr * 0.6, '#f4e3ff');
      if (!view.season.throneUnsealed) lock(ctx, p.x + rr * 0.9, p.y + rr * 0.55, rr * 0.4);
    }
    if (r >= LABEL_MIN_PX) {
      const text = town.garrison ? formatNumber(totalTroops(town.garrison)) : '?';
      label(ctx, text, p.x, p.y + rr + 16, 11);
    }
    if (targets?.has(town.id)) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = GOLD;
      circle(ctx, p, rr + 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (input.selected === town.id) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      circle(ctx, p, rr + 7 + Math.sin(time / 220) * 2);
      ctx.stroke();
    }
    if (input.highlight === town.id) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = GOLD;
      circle(ctx, p, rr + 14 + Math.sin(time / 180) * 5);
      ctx.stroke();
    }
  }
}

/** Towns a march from `source` may target: its isle and isles one lane away. */
export function targetsFrom(view: LordView, source: TownView): Set<number> {
  const linked = linkedIsles(view, source.isleId);
  return new Set(view.towns.filter((t) => t.id !== source.id && linked.has(t.isleId)).map((t) => t.id));
}

export function drawScene(ctx: CanvasRenderingContext2D, input: SceneInput): void {
  const { view } = input;
  const sourceId = input.picking ? input.selected : input.sendFrom;
  const source = sourceId === null ? undefined : view.towns[sourceId];
  sky(ctx, input.size);
  windStreaks(ctx, input);
  lanes(ctx, input, source ? source.isleId : null);
  isles(ctx, input);
  marches(ctx, input);
  towns(ctx, input, input.picking && source ? targetsFrom(view, source) : null);
}
