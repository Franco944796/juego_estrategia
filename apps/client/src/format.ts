import { defaultConfig } from '@si/config';

const SUFFIXES = defaultConfig.display.suffixes;

/** Three significant digits with K, M, G… suffixes: 1.45K, 14.5K, 145K, 1.45M. */
export function formatNumber(value: number, lang: 'es' | 'en' = 'en'): string {
  const sign = value < 0 ? '-' : '';
  let n = Math.abs(value);
  if (n < 1000) return sign + String(Math.floor(n));
  let i = 0;
  while (n >= 1000 && i < SUFFIXES.length - 1) {
    n /= 1000;
    i++;
  }
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  // Truncates rather than rounds (999.9K never shows as 1000K); the epsilon absorbs float error.
  const text = (Math.floor(n * 10 ** digits + 1e-6) / 10 ** digits).toFixed(digits);
  return sign + (lang === 'es' ? text.replace('.', ',') : text) + (SUFFIXES[i] ?? '');
}

/** One decimal, with the language's decimal mark. */
export function formatDecimal(value: number, lang: 'es' | 'en', digits = 1): string {
  const text = value.toFixed(digits);
  return lang === 'es' ? text.replace('.', ',') : text;
}

/** m:ss, or h:mm:ss from one hour up. Negative durations show as 0:00. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const PREFIXES = ['Bru', 'Cel', 'Nim', 'Ven', 'Ast', 'Lun', 'Mir', 'Sol', 'Zef', 'Tor', 'Gal', 'Ori'];
const SUFFIXES_NAME = ['mar', 'dor', 'vel', 'ria', 'nas', 'ton', 'lia', 'gar', 'ven', 'sur', 'tia', 'bel'];

/** Unique for the first 144 ids: prefix from id mod 12, suffix from id div 12. */
export function townName(id: number): string {
  const prefix = PREFIXES[id % PREFIXES.length] ?? '';
  const suffix = SUFFIXES_NAME[Math.floor(id / PREFIXES.length) % SUFFIXES_NAME.length] ?? '';
  const name = prefix + suffix;
  return id < PREFIXES.length * SUFFIXES_NAME.length ? name : `${name} ${Math.floor(id / 144) + 1}`;
}
