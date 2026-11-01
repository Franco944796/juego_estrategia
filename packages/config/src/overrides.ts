import { gameConfigSchema, type GameConfig } from './schema';

export function validateConfig(input: unknown): GameConfig {
  return gameConfigSchema.parse(input);
}

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

// Objects merge key by key; arrays and scalars are replaced whole.
export function withOverrides(base: GameConfig, patch: DeepPartial<GameConfig>): GameConfig {
  return validateConfig(merge(base, patch));
}

function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) out[key] = merge(base[key], value);
    return out;
  }
  return patch;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
