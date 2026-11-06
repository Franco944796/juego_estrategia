import { defaultConfig } from '@si/config';
import { WIND_VECTORS, windFactor, type LordView, type TownView } from '@si/engine';
import { formatNumber, formatRange } from '../format';
import { isAlly, linkedIsles, NEUTRAL_COLOR, ownerColor, townById } from '../ui/labels';
import { QUALITY } from '../map3d/quality';
import { beaconSpot, flatIsle, type FlatIsle } from '../map3d/terrain';
import { Territory } from '../map3d/territory';
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
const ALLY = '#4cc9f0';

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

export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color = '#ffffff',
): void {
  ctx.font = `800 ${px}px Nunito, system-ui, -apple-system, "Segoe UI", sans-serif`;
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

/** Painted isles, one per isle and town count (roads and fields keep clear of towns). */
const flatCache = new Map<number, { key: string; flat: FlatIsle; territory: Territory }>();
const FLAT_TEXTURE = 1536;
const FLAT_TERRITORY = 768;
const OUTLINE_POINTS = 120;
/** Cliff height in world units, as it shows below the grass edge. */
const CLIFF = 12;

function flatFor(view: LordView, isle: LordView['isles'][number]): { flat: FlatIsle; territory: Territory } {
  const key = `${view.towns.length}`;
  const cached = flatCache.get(isle.id);
  if (cached?.key === key) return cached;
  const flat = flatIsle(view, isle, QUALITY.medium, FLAT_TEXTURE);
  const entry = { key, flat, territory: new Territory(flat, isle.id, FLAT_TERRITORY) };
  flatCache.set(isle.id, entry);
  return entry;
}

function outline(ctx: CanvasRenderingContext2D, flat: FlatIsle, input: SceneInput, dy = 0, scale = 1): void {
  const { pos } = flat.field.isle;
  ctx.beginPath();
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const a = (i / OUTLINE_POINTS) * Math.PI * 2;
    const r = flat.field.radiusAt(a) * scale;
    const p = worldToScreen(input.cam, input.size, {
      x: pos.x + Math.cos(a) * r,
      y: pos.y + Math.sin(a) * r,
    });
    if (i === 0) ctx.moveTo(p.x, p.y + dy);
    else ctx.lineTo(p.x, p.y + dy);
  }
  ctx.closePath();
}

function isles(ctx: CanvasRenderingContext2D, input: SceneInput): void {
  const { view, cam, size } = input;
  for (const isle of view.isles) {
    const c = worldToScreen(cam, size, isle.pos);
    const r = isle.radius * cam.zoom;
    if (c.x < -r * 2 || c.y < -r * 2 || c.x > size.width + r * 2 || c.y > size.height + r * 2) continue;
    const { flat, territory } = flatFor(view, isle);
    territory.update(view);
    const under = ctx.createLinearGradient(0, c.y, 0, c.y + r * 1.2);
    under.addColorStop(0, '#5d4a3a');
    under.addColorStop(1, '#2a211b');
    outline(ctx, flat, input, r * 0.34, 0.86);
    ctx.fillStyle = under;
    ctx.fill();
    const cliff = Math.max(3, CLIFF * cam.zoom);
    for (const [k, color] of ['#6d5641', '#957a5c', '#76593f', '#8a6a4a', '#6b4f35'].entries()) {
      outline(ctx, flat, input, cliff * (1 - k / 5));
      ctx.fillStyle = color;
      ctx.fill();
    }
    // Waterfalls pour from the streams' mouths down the cliff and the rock below.
    for (const st of flat.field.streams) {
      const mouth = worldToScreen(cam, size, st.b);
      const w = Math.max(2, 3.2 * cam.zoom);
      const fall = ctx.createLinearGradient(0, mouth.y, 0, mouth.y + cliff + r * 0.25);
      fall.addColorStop(0, 'rgba(120, 190, 240, 0.95)');
      fall.addColorStop(0.6, 'rgba(200, 232, 255, 0.7)');
      fall.addColorStop(1, 'rgba(230, 245, 255, 0)');
      ctx.fillStyle = fall;
      ctx.beginPath();
      ctx.moveTo(mouth.x - w / 2, mouth.y);
      ctx.lineTo(mouth.x + w / 2, mouth.y);
      ctx.lineTo(mouth.x + w, mouth.y + cliff + r * 0.25);
      ctx.lineTo(mouth.x - w, mouth.y + cliff + r * 0.25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    outline(ctx, flat, input);
    ctx.clip();
    const corner = worldToScreen(cam, size, { x: flat.x0, y: flat.z0 });
    ctx.drawImage(flat.canvas, corner.x, corner.y, flat.span * cam.zoom, flat.span * cam.zoom);
    ctx.drawImage(territory.canvas, corner.x, corner.y, flat.span * cam.zoom, flat.span * cam.zoom);
    ctx.restore();
    outline(ctx, flat, input);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(50, 70, 28, 0.9)';
    ctx.stroke();
  }
}

/** Lit zones glow in their owner's color; every zone has a beacon post at its centre. */
function zones(ctx: CanvasRenderingContext2D, input: SceneInput): void {
  const { view, cam, size, time } = input;
  const glow = TOWN_RADIUS * 1.9 * cam.zoom;
  const post = Math.max(7, 16 * cam.zoom);
  for (const zone of view.zones) {
    const c = worldToScreen(cam, size, beaconSpot(view, zone));
    if (c.x < -200 || c.y < -200 || c.x > size.width + 200 || c.y > size.height + 200) continue;
    const owner = zone.beaconOwner;
    if (owner) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = ownerColor(view, owner);
      ctx.beginPath();
      for (const id of zone.townIds) {
        const town = townById(view, id);
        if (!town) continue;
        const p = worldToScreen(cam, size, town.pos);
        ctx.moveTo(p.x + glow, p.y);
        ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = '#2b2118';
    ctx.lineWidth = Math.max(1.5, post * 0.18);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y + post * 0.5);
    ctx.lineTo(c.x, c.y - post * 0.5);
    ctx.stroke();
    circle(ctx, { x: c.x, y: c.y - post * 0.5 }, Math.max(2.5, post * 0.28));
    if (owner) {
      ctx.save();
      ctx.shadowColor = ownerColor(view, owner);
      ctx.shadowBlur = 12 + Math.sin(time / 300) * 4;
      ctx.fillStyle = ownerColor(view, owner);
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
    const from = townById(view, m.from);
    const to = townById(view, m.to);
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
    const amount =
      m.troops !== null ? formatNumber(m.troops) : m.troopRange ? formatRange(m.troopRange) : null;
    if (amount) label(ctx, amount, cur.x, cur.y - 14, 11, m.incoming ? HOSTILE : '#ffffff');
    if (m.incoming) {
      ctx.strokeStyle = HOSTILE;
      ctx.lineWidth = 2;
      circle(ctx, b, townRadiusPx(cam) + 8 + Math.sin(time / 160) * 3);
      ctx.stroke();
    }
  }
}

/** The mark of a capital that cannot be attacked: a small filled shield. */
export function shield(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s * 0.85, cy - s * 0.65);
  ctx.lineTo(cx + s * 0.8, cy + s * 0.05);
  ctx.quadraticCurveTo(cx + s * 0.6, cy + s * 0.75, cx, cy + s);
  ctx.quadraticCurveTo(cx - s * 0.6, cy + s * 0.75, cx - s * 0.8, cy + s * 0.05);
  ctx.lineTo(cx - s * 0.85, cy - s * 0.65);
  ctx.closePath();
  ctx.fillStyle = '#7fb4ff';
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.25);
  ctx.strokeStyle = INK;
  ctx.stroke();
}

export function crown(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
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

function polygon(ctx: CanvasRenderingContext2D, p: Vec, radii: number[], turn: number): void {
  ctx.beginPath();
  radii.forEach((radius, i) => {
    const a = turn + (i / radii.length) * Math.PI * 2;
    const x = p.x + Math.cos(a) * radius;
    const y = p.y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Town body by the owner's cosmetic style; ids match `cosmetics.styles` in the config. */
export function townShape(ctx: CanvasRenderingContext2D, style: string, p: Vec, r: number): void {
  const up = -Math.PI / 2;
  switch (style) {
    case 'tower':
      ctx.beginPath();
      ctx.roundRect(p.x - r * 0.9, p.y - r * 0.9, r * 1.8, r * 1.8, r * 0.3);
      return;
    case 'hex':
      polygon(ctx, p, Array<number>(6).fill(r * 1.05), up);
      return;
    case 'diamond':
      polygon(ctx, p, Array<number>(4).fill(r * 1.2), up);
      return;
    case 'star':
      polygon(
        ctx,
        p,
        Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? r * 1.25 : r * 0.8)),
        up,
      );
      return;
    case 'crystal':
      polygon(
        ctx,
        p,
        Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? r * 1.15 : r * 0.95)),
        up,
      );
      return;
    default:
      circle(ctx, p, r);
  }
}

function towns(ctx: CanvasRenderingContext2D, input: SceneInput, targets: Set<number> | null): void {
  const { view, cam, size, time } = input;
  const r = townRadiusPx(cam);
  const styles = new Map(view.lords.map((l) => [l.id, l.style]));
  const shown = view.towns
    .map((town) => ({ town, p: worldToScreen(cam, size, town.pos), rr: town.isThrone ? r * 1.35 : r }))
    .filter(({ p }) => p.x >= -40 && p.y >= -40 && p.x <= size.width + 40 && p.y <= size.height + 40);

  for (const { town, p, rr } of shown) {
    const style = (town.owner && styles.get(town.owner)) || 'classic';
    townShape(ctx, style, { x: p.x + 1.5, y: p.y + 2.5 }, rr);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    townShape(ctx, style, p, rr);
    ctx.fillStyle = town.owner === null ? NEUTRAL_COLOR : ownerColor(view, town.owner);
    ctx.fill();
    const bevel = ctx.createRadialGradient(p.x - rr * 0.35, p.y - rr * 0.4, rr * 0.1, p.x, p.y, rr * 1.15);
    bevel.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    bevel.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
    bevel.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    ctx.fillStyle = bevel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (town.isPrivate) {
      ctx.setLineDash([2, 3]);
      circle(ctx, p, rr + 3);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (town.owner === view.me.id) {
      circle(ctx, p, rr + 3);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else if (isAlly(view, town.owner)) {
      ctx.setLineDash([3, 3]);
      circle(ctx, p, rr + 3);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ALLY;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    label(ctx, String(town.tier), p.x, p.y, Math.max(9, rr * (town.tier >= 10 ? 0.8 : 1)));
    if (town.isCapital) crown(ctx, p.x, p.y - rr - 6, rr * 0.5, GOLD);
    if (town.isCapital && view.season.capitalImmune) shield(ctx, p.x + rr * 0.95, p.y - rr * 0.8, rr * 0.38);
    if (town.isThrone) {
      crown(ctx, p.x, p.y - rr - 8, rr * 0.6, '#f4e3ff');
      if (!view.season.throneUnsealed) lock(ctx, p.x + rr * 0.9, p.y + rr * 0.55, rr * 0.4);
    }
  }

  // Second pass, so a town drawn later never hides a neighbor's garrison label.
  for (const { town, p, rr } of shown) {
    if (r >= LABEL_MIN_PX) {
      const text = town.garrison !== null ? formatNumber(town.garrison) : '?';
      label(ctx, text, p.x, p.y + rr + 10, 11);
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
  const source = townById(view, sourceId);
  sky(ctx, input.size);
  windStreaks(ctx, input);
  lanes(ctx, input, source ? source.isleId : null);
  isles(ctx, input);
  zones(ctx, input);
  marches(ctx, input);
  towns(ctx, input, input.picking && source ? targetsFrom(view, source) : null);
}
