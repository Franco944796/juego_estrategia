export type Theme = 'pergamino' | 'noche';

/** «Pergamino» from 7:00 to 18:59 local time, «Noche de las islas» the rest (the design system's rule). */
export const DAY_FROM_HOUR = 7;
export const NIGHT_FROM_HOUR = 19;
const OVERRIDE_KEY = 'shattered-isles:theme';

export function themeAt(date: Date): Theme {
  const hour = date.getHours();
  return hour >= DAY_FROM_HOUR && hour < NIGHT_FROM_HOUR ? 'pergamino' : 'noche';
}

/** A stored theme wins over the clock; only tests and screenshots set it. */
function override(): Theme | null {
  try {
    const value = localStorage.getItem(OVERRIDE_KEY);
    return value === 'pergamino' || value === 'noche' ? value : null;
  } catch {
    return null;
  }
}

/** Applies the theme of the hour now and again every minute; returns the stop function. */
export function followDaylight(): () => void {
  const apply = (): void => {
    document.documentElement.dataset.theme = override() ?? themeAt(new Date());
  };
  apply();
  const timer = setInterval(apply, 60_000);
  return () => clearInterval(timer);
}
