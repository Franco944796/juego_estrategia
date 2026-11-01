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

## Hecho

- 2026-10-31 · Entorno: Node 26.13, pnpm 12.16. TypeScript 6.0 (no 7.0: typescript-eslint exige
  < 6.1). pnpm 12 pide aprobar scripts de build: `allowBuilds: esbuild` en `pnpm-workspace.yaml`.
  Chromium de Playwright en `~/.cache/ms-playwright`.
- Commit `M0+M1`: andamiaje, `packages/config`, `packages/engine` (reglas R01–R14, bots, vistas).
- Commit `M2`: `tools/sim` + `docs/BALANCE.md` (eliminaciones 5,2 → 3,0 por temporada de 8 señores;
  exilio a cualquier pueblo neutral libre).
- Commit `M3`: cliente web + `demo/shattered-isles.html` (507 KB, 152 KB gzip, funciona offline).
- Verificado: lint, typecheck, 116 tests unitarios, cobertura del motor 99,8 % de líneas, 4 tests de
  Playwright (390×844 es-AR y 1280×800 en-US) y revisión visual de las capturas.
- `prueba_ML` agregado a `proyectos_vscode.code-workspace`.
- Prompt original de la raíz enviado a la papelera (recuperable desde la papelera del sistema).

## En curso

- Nada. Etapa «motor + demo offline» terminada.

## Pendiente (próximas etapas, si Franco las pide)

1. Balance: parte del ganador (0,37 vs ≤ 0,35) y capturas del Trono (1,6 vs 2–6); próximo ajuste
   probable: `attackMargin` de los bots.
2. Servidor multijugador (REST + WebSocket, actor por temporada, log de comandos con replay) y
   `RemoteGameClient`.
3. Cuentas, clanes, chat, ligas entre temporadas.
4. Remoto de git (GitHub) para hacer push: no configurado.

## Comandos

- `pnpm install` · `pnpm check` (lint + typecheck + tests) · `pnpm coverage`
- `pnpm sim --bots 8 --seed 1 --runs 5 [--write]`
- `pnpm build:demo` → `demo/shattered-isles.html` · `pnpm e2e` · `pnpm dev`

## Problemas conocidos

- Balance: parte del ganador 0,37 (objetivo ≤ 0,35), capturas del Trono 1,6 (objetivo 2–6), tensión
  PvP 0,40 (borde). Detalle en `docs/BALANCE.md`.

## Notas del motor (no obvias en el código)

- El estado solo cambia en comandos y eventos programados; `advanceTo` no acumula hasta `now`.
  Las vistas y validaciones usan proyecciones con la misma aritmética, así un replay da el mismo
  hash.
- La misión de una marcha se decide al llegar: si el pueblo es propio, refuerza; si no, ataca.
- El factor de viento queda fijo al salir la marcha.
