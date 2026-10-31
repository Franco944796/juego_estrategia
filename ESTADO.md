# ESTADO — prueba_ML (Shattered Isles)

## Objetivo

- Juego **original** de conquista en tiempo real, mobile-first, en islas flotantes («Shattered Isles»).
- El prompt de origen pedía replicar Million Lords con otro nombre: esa parte se rechazó. Del prompt se
  reusa solo el nombre, el lore liviano, el stack y la vara de calidad.
- Esta etapa: motor determinista + bots + demo para un jugador en un único HTML offline.

## Decisiones tomadas (2026-10-30)

- Diseño «Vientos y 3 tropas» (detalle en `docs/DESIGN.md`):
  - viento rotativo con pronóstico; entre islas: a favor ×2, cruzado ×1, en contra ×0,5;
  - Lanceros > Grifos > Arqueros > Lanceros; cada pueblo entrena según su especialidad;
  - faro por isla completa (+producción, +visión); Trono del Cielo central que da Dominio por minuto;
  - temporada corta; gana quien tenga más Dominio.
- Alcance de esta sesión: monorepo TS (`packages/config`, `packages/engine`, `apps/client`, `tools/sim`),
  Vitest + fast-check + Playwright, cobertura del motor ≥ 90 %, bots, demo single-file offline
  (celular y escritorio). Servidor, meta, clanes y tienda: pendientes.
- Del prompt: TS strict, sin `any` en el motor, ESLint + Prettier, sin números mágicos (todo en config
  validada con zod), motor sin reloj ni `Math.random` (PRNG con semilla en el estado), UI es/en según el
  idioma del dispositivo, código y docs en inglés, comunicación en español.
- `ESTADO.md` reemplaza a PLAN.md y PROGRESS.md del prompt.
- Node: lo instala Franco con pacman (`sudo pacman -S --needed nodejs npm pnpm`).
- Git: commit local al cerrar cada hito, sin push (excepción a la regla general de commits manuales).
- Al terminar: mandar a la papelera (`gio trash`) el archivo del prompt de la raíz, como pidió Franco.

## Hecho (2026-10-30, sin compilar todavía: no hay Node)

- `docs/DESIGN.md`: diseño completo con el registro de reglas R01–R14.
- `packages/config/src`: `constants.ts`, `schema.ts` (zod), `defaults.ts`, `index.ts`
  (`validateConfig`, `withOverrides`).
- `packages/engine/src` completo: `types`, `rng` (xoshiro128**), `queue`, `troops`, `geometry`,
  `mapgen`, `modifiers`, `economy`, `combat`, `world`, `marches`, `commands` (R01–R14), `vision`,
  `bots`, `game` (`createGame`, `advanceTo`, `execute`, `computeStandings`), `view`, `preview`,
  `hash`, `index`.
- Andamiaje M0 escrito: `package.json` raíz y de `config`/`engine` (sin dependencias todavía),
  `pnpm-workspace.yaml`, `tsconfig.base.json`, `.prettierrc.json`, `vitest.config.ts`, CI.
- Tests escritos (sin correr): `packages/engine/test/` (helpers, rng, queue, geometry, combat,
  mapgen, economy, rules, marches, bots, view, preview, hash, properties) y
  `packages/config/test/config.test.ts`.
- `tools/sim`: `src/simulate.ts` (métricas y objetivos de ritmo), `src/cli.ts`
  (`pnpm sim --bots 8 --seed 1 --runs 5 --write` → `docs/BALANCE.md`), `test/sim.test.ts`.

- `apps/client` escrito (sin compilar): Vite + React + Zustand, `src/game/` (protocolo, worker con
  el motor y reloj acelerado, `LocalGameClient`, sesión con guardado en localStorage y pausa al
  ocultar la pestaña), `src/map/` (cámara, render Canvas 2D, gestos), `src/ui/` (HUD, hojas de pueblo
  y envío, paneles, tutorial, toasts, fin de temporada, pantalla de título), `styles.css`, i18n es/en,
  tests unitarios (`test/`) y Playwright (`e2e/smoke.spec.ts`, 390×844 es-AR y 1280×800 en-US).
  `pnpm build:demo` deja la demo en `demo/shattered-isles.html`.

## En curso

- Esperando Node para compilar y probar todo (nada se ejecutó todavía).
- Al retomar: comprobar `node -v`; si falta, pedir `sudo pacman -S --needed nodejs npm pnpm`.

## Pendiente

1. Con Node, en la raíz: `pnpm add -w -D typescript vitest @vitest/coverage-v8 fast-check eslint
@eslint/js typescript-eslint eslint-config-prettier eslint-plugin-react-hooks prettier tsx
@types/node`; `pnpm --filter @si/config add zod`; en `apps/client`: `react react-dom zustand` y dev
   `vite @vitejs/plugin-react vite-plugin-singlefile @types/react @types/react-dom @playwright/test`.
   `packageManager` en `package.json` (lo usa la CI), `eslint.config.js`.
2. Typecheck, lint, tests, cobertura ≥ 90 % del motor; corregir. `git init`, commit M0+M1.
3. `pnpm sim --write`, ajustar valores, registrar en `docs/BALANCE.md`. Commit.
4. Build de la demo, Playwright, revisión visual de capturas. Commit.
5. README, ESTADO final y papelera del prompt de la raíz.

## Notas del motor (no obvias en el código)

- El estado solo cambia en comandos y eventos programados; `advanceTo` no acumula hasta `now`.
  Las vistas y validaciones usan proyecciones con la misma aritmética, así un replay da el mismo
  hash.
- La misión de una marcha se decide al llegar: si el pueblo es propio, refuerza; si no, ataca.
- El factor de viento queda fijo al salir la marcha.
