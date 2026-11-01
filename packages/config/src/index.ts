export * from './constants';
export { gameConfigSchema } from './schema';
export type { GameConfig, PersonalityConfig } from './schema';
export { defaultConfig } from './defaults';
export { validateConfig, withOverrides, type DeepPartial } from './overrides';
export { liveConfig } from './presets';
