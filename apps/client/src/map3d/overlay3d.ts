import { defaultConfig } from '@si/config';
import { windFactor } from '@si/engine';
import { formatNumber, formatRange } from '../format';
import { TOWN_RADIUS, crown, label, shield, windColor } from '../map/render';
import type { BridgeTop } from './bridges';
import { townById } from '../ui/labels';
import { TILT, toScreen3d } from './camera3d';
import { UNIT_SCALE } from './models';
import { FLIGHT_HEIGHT, type Scene3DInput } from './world3d';

const HOSTILE = '#ff4d4d';
const GOLD = '#ffd166';
/** Below this many pixels per town, garrison labels would pile up, so only levels show. */
const GARRISON_MIN_PX = 11;
const BANNER_TOP = 4.4 * UNIT_SCALE;

/**
 * Text and marks drawn in 2D over the 3D map: levels, garrisons, capital crowns, private-town rings
 * and march routes with their sizes. `height` and `radius` give the size of a town's model, `ground`
 * the height of the hills under a march, `bridgeTop` the middle of the light bridge between two isles.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  input: Scene3DInput,
  height: (level: number) => number,
  radius: (level: number) => number,
  ground: (p: { x: number; y: number }) => number,
  bridgeTop: (a: number, b: number) => BridgeTop | null,
): void {
  const { view, cam, size, gameNow } = input;
  ctx.clearRect(0, 0, size.width, size.height);
  const townPx = TOWN_RADIUS * cam.zoom;
  const inside = (p: { x: number; y: number }): boolean =>
    p.x > -40 && p.y > -40 && p.x < size.width + 40 && p.y < size.height + 40;

  const source = townById(view, input.sendFrom)?.isleId;
  for (const lane of source === undefined ? [] : view.lanes) {
    if (lane.a !== source && lane.b !== source) continue;
    const src = view.isles[source];
    const dst = view.isles[lane.a === source ? lane.b : lane.a];
    if (!src || !dst) continue;
    const { tailwindMax, headwindMin } = defaultConfig.wind;
    const factor = windFactor(src.pos, dst.pos, view.wind.dir, tailwindMax, headwindMin);
    const top = bridgeTop(lane.a, lane.b);
    if (!top) continue;
    const at = toScreen3d(cam, size, top, top.height + 3);
    if (inside(at)) label(ctx, `×${factor.toFixed(1)}`, at.x, at.y, 13, windColor(factor));
  }

  for (const m of view.marches) {
    const from = townById(view, m.from);
    const to = townById(view, m.to);
    if (!from || !to) continue;
    const span = Math.max(1, m.arriveAt - m.departAt);
    const f = Math.min(1, Math.max(0, (gameNow - m.departAt) / span));
    const cur = { x: from.pos.x + (to.pos.x - from.pos.x) * f, y: from.pos.y + (to.pos.y - from.pos.y) * f };
    const lift = m.sky ? FLIGHT_HEIGHT : ground(cur);
    const a = toScreen3d(cam, size, cur, lift);
    const b = toScreen3d(cam, size, to.pos);
    ctx.strokeStyle = m.incoming ? HOSTILE : m.mine ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = m.mine || m.incoming ? 2 : 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const amount =
      m.troops !== null ? formatNumber(m.troops) : m.troopRange ? formatRange(m.troopRange) : null;
    if (amount) {
      const top = toScreen3d(cam, size, cur, lift + BANNER_TOP);
      label(ctx, amount, top.x, top.y - 8, 11, m.incoming ? HOSTILE : '#ffffff');
    }
  }

  for (const town of view.towns) {
    const base = toScreen3d(cam, size, town.pos);
    if (!inside(base)) continue;
    const top = toScreen3d(cam, size, town.pos, height(town.tier));
    if (town.isPrivate) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, townPx, townPx * Math.sin(TILT), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const px = Math.max(10, Math.min(14, townPx * 0.6));
    label(ctx, String(town.tier), top.x, top.y - px * 0.8, px);
    if (town.isCapital) crown(ctx, top.x, top.y - px * 2.1, px * 0.55, GOLD);
    if (town.isCapital && view.season.capitalImmune)
      shield(ctx, top.x + px * 1.2, top.y - px * 2.1, px * 0.5);
    if (townPx >= GARRISON_MIN_PX) {
      const text = town.garrison !== null ? formatNumber(town.garrison) : '?';
      // In front of the model (the camera looks from the south), not over it.
      const front = toScreen3d(cam, size, { x: town.pos.x, y: town.pos.y + radius(town.tier) });
      label(ctx, text, front.x, front.y + 9, 11);
    }
  }
}
