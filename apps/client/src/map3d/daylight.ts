import { Color, Vector3 } from 'three';
import { DAY_FROM_HOUR, NIGHT_FROM_HOUR, themeAt, themeOverride } from '../theme';

/** The light of the hour: where it comes from, its colors and how the far background looks. */
export interface Daylight {
  night: boolean;
  /** Unit vector toward the sun, or the moon at night. */
  toLight: Vector3;
  light: Color;
  lightPower: number;
  /** Light from the sky above and bounced from below. */
  sky: Color;
  bounce: Color;
  ambientPower: number;
  /** Strength of the reflected sky on surfaces. */
  envPower: number;
  /** Top and horizon of the sky that surfaces reflect (the camera never looks up at it). */
  zenith: Color;
  horizon: Color;
  /** Distant haze: isles fade into it. */
  haze: Color;
  /** Lit and shaded sides of the cloud sea, and the depth under it. */
  cloudLit: Color;
  cloudShade: Color;
  abyss: Color;
  /** How much cloud shadows dim the ground (0–1). */
  cloudShadow: number;
  /** A key that changes when the sky must be rebuilt for reflections. */
  key: string;
}

/** With a forced theme (tests, screenshots) the hour is fixed too, so pictures do not change. */
const FIXED_DAY_HOUR = 10.5;
const MIN_SUN_HEIGHT = 0.5;

function mix(a: string, b: string, t: number): Color {
  return new Color(a).lerp(new Color(b), Math.min(1, Math.max(0, t)));
}

export function daylightNow(now = new Date()): Daylight {
  const forced = themeOverride();
  const night = (forced ?? themeAt(now)) === 'noche';
  if (night) {
    return {
      night,
      toLight: new Vector3(-0.55, 1, 0.45).normalize(),
      light: new Color('#a9c1ff'),
      lightPower: 1.6,
      sky: new Color('#4a66a8'),
      bounce: new Color('#1b2238'),
      ambientPower: 1.15,
      envPower: 0.7,
      zenith: new Color('#0b1430'),
      horizon: new Color('#27406e'),
      haze: new Color('#0f1b38'),
      cloudLit: new Color('#5c76ad'),
      cloudShade: new Color('#16223f'),
      abyss: new Color('#070d1e'),
      cloudShadow: 0.25,
      key: 'night',
    };
  }
  const hour = forced ? FIXED_DAY_HOUR : now.getHours() + now.getMinutes() / 60;
  // 0 at sunrise, 1 at sunset.
  const t = Math.min(1, Math.max(0, (hour - DAY_FROM_HOUR) / (NIGHT_FROM_HOUR - DAY_FROM_HOUR)));
  const height = Math.sin(Math.PI * t);
  // The sun crosses from the left to the right of the screen, always a little toward the camera,
  // so the fronts of buildings are never in full shade.
  const toLight = new Vector3(
    -Math.cos(Math.PI * t) * 0.95,
    MIN_SUN_HEIGHT + height * 0.75,
    0.4 + height * 0.2,
  );
  toLight.normalize();
  // 1 near sunrise and sunset, 0 through the middle of the day.
  const golden = 1 - Math.min(1, height / 0.55);
  return {
    night,
    toLight,
    light: mix('#fff3e0', '#ffb877', golden),
    lightPower: 3.3 - golden * 0.5,
    sky: mix('#bcd6ff', '#c9b8c9', golden),
    bounce: mix('#6f6650', '#6b5346', golden),
    ambientPower: 0.7,
    envPower: 0.5,
    zenith: mix('#2f6fd0', '#4a5f9e', golden),
    horizon: mix('#b9d6f2', '#f0c7a0', golden),
    haze: mix('#9fc3e8', '#d9b9a6', golden),
    cloudLit: mix('#ffffff', '#ffe2c2', golden),
    cloudShade: mix('#8fa9cc', '#a58f9c', golden),
    abyss: mix('#3f6ea8', '#5b5f8c', golden),
    cloudShadow: 0.38,
    // The sun moves little in ten minutes: the reflected sky is rebuilt at that pace.
    key: `day-${Math.round(t * 72)}`,
  };
}
