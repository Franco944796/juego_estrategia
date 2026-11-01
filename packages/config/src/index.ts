export * from './constants';
export { gameConfigSchema } from './schema';
export type { EdictEffect, GameConfig, PersonalityConfig } from './schema';
export { defaultConfig } from './defaults';
export { validateConfig, withOverrides, type DeepPartial } from './overrides';
export { liveConfig } from './presets';
