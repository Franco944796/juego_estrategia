# ESTADO — juego_estrategia (Shattered Isles; antes prueba_ML)

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
- Git: Claude hace commits locales por hito; el push lo hace Franco (decidido 2026-11-01).
- Clanes y chat (decidido 2026-11-01): clanes con solicitud que acepta líder u oficial, máximo 20,
  persisten entre temporadas; entre miembros no hay ataques, se comparte visión y se puede reforzar
  pueblos aliados (guarniciones de varios dueños); chat global y de clan (200 caracteres, límite de
  envíos, últimos 100 guardados); ranking de clanes por suma de Dominio, medalla al clan ganador sin
  Legado extra.
- Servidor multijugador (decidido 2026-10-31):
  - un único mundo público siempre abierto; temporada de 30 días en tiempo real (×1); al terminar se
    reinicia y cada jugador vuelve a empezar con una ciudad de nivel 1 al conectarse;
  - una sola liga; el mapa crece (anillo nuevo de islas) cuando no quedan islas de inicio libres;
  - sin bots en el mundo en línea (el simulador sí usa bots para medir el ritmo);
  - la capital nunca puede ser atacada; no hay escudos;
  - recompensas por puesto: 5 % superior, 25 %, 50 % y el resto → puntos de Legado (más arriba, más
    puntos), canjeables solo por estilos de ciudad (cosméticos);
  - corre en la PC de Franco y su red local (`pnpm serve`, puerto 8787); SQLite nativo de Node
    (`node:sqlite`), log de órdenes aceptadas + foto del estado cada 5 min, replay al reiniciar;
  - stack: Fastify + @fastify/websocket + @fastify/static, identidad por token en el navegador con
    código de recuperación;
  - la demo offline queda igual (capitales atacables, ×20, bots).
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

- Nada. Etapa «clanes y chat» terminada el 2026-11-01.

## Hecho en la etapa de clanes y chat (2026-11-01)

- Motor (`packages/engine/src/alliances.ts`, `marches.ts`, `combat.ts`): `setClan`, tropas
  estacionadas en pueblos aliados, defensa conjunta (`resolveSiege`), retiro de tropas, R15 permite
  reforzar capitales aliadas, regreso al romperse la alianza, visión compartida, `migrateState`.
- Servidor (`apps/server/src/clans.ts`, `store.ts`, `app.ts`): clanes con solicitudes, rangos y
  sucesión del líder, máximo 20; ranking de clanes y medalla al cierre; chat global/clan por
  WebSocket con historial y límite de envíos.
- Cliente: pestaña «Social» (chat Todos/Mi clan, clan: fundar, buscar, solicitudes, miembros,
  rangos), ranking Señores/Clanes, reforzar y retirar tropas en pueblos aliados, anillo celeste en
  pueblos aliados, avisos de refuerzos, informes desde el punto de vista del aliado, clan ganador en
  el salón de la fama.
- Verificado: 158 tests unitarios, 14 de Playwright (incluido clanes y chat con dos navegadores),
  revisión visual de chat, clan, solicitudes y ranking de clanes.

## Hecho en la etapa del servidor (2026-10-31)

- Config: `rules.capitalImmune`, `map.growth`, `rewards.tiers`, `cosmetics.styles`,
  `display.lordColors`, `towns.homeIsleFort`, `towns.sprawl`; preset `liveConfig`
  (`packages/config/src/presets.ts`).
- Motor: `joinLord`, `expandMap`, `setStyle` (`packages/engine/src/join.ts`), R15 capital inmune,
  `MARCH_REPELLED`, frenos de bola de nieve, `season.capitalImmune` en la vista.
- `tools/sim --preset live`: 11/11 objetivos del mundo mensual (`docs/BALANCE.md`).
- `packages/protocol`: tipos compartidos de REST y WebSocket.
- `apps/server`: Fastify + WebSocket + node:sqlite, replay al reiniciar, cierre mensual con Legado,
  cuentas invitadas con código de recuperación, estilos, salón de la fama; `TIME_SCALE` solo para
  tests.
- Cliente: modo «Mundo en línea» (`RemoteGameClient`, título, perfil con estilos/medallas/código,
  aviso de fin de temporada, aviso de conexión), formas de ciudad por estilo, duraciones en días.
- Verificado: 144 tests unitarios, cobertura del motor 99,8 %, 5 tests de Playwright (incluido uno con
  dos jugadores en línea contra el servidor real), revisión visual de título y perfil en línea.

## Revisión visual (2026-11-01)

- `apps/client/e2e/tour.spec.ts` arma partidas guardadas con el motor (edicto pendiente, ataque
  entrante, pueblo enemigo y vuelo entre islas, fin de temporada) y saca capturas en celular y
  escritorio, con control de desbordes y texto cortado. 13 tests de Playwright en verde.
- Corregido: etiquetas de guarnición tapadas por pueblos vecinos (dibujo en dos pasadas); la pista
  «si esperás el viento» solo aparece si así llegás antes; el cierre dice «X gana la temporada».

## Balance de la demo (2026-11-01)

- Demo con los mismos frenos que el mundo en línea, más suaves (isla de la capital ×1,5; −5 % por pueblo
  pasados 8) y guarnición del Trono 240 (el mundo en línea mantiene 300). 11/11 objetivos en 12
  temporadas; `pnpm sim` usa 12 corridas por defecto en la demo. Registro en `docs/BALANCE.md`.
- Corregido: al elegir destino la cámara centra el pueblo de origen (antes algunos destinos quedaban
  debajo de la burbuja del tutorial y el toque no llegaba; el test fallaba a veces); cartel de
  «elegí destino» en una línea; el test en línea ya no supone un mundo vacío.
- La carpeta se renombró a `juego_estrategia`; el workspace de VS Code apunta a la ruta nueva.

## Pendiente

1. Abrir el puerto 8787 en el firewall para jugar desde el celular (acción de Franco):
   `sudo firewall-cmd --add-port=8787/tcp` (con `--permanent` para que quede).
2. Subir el repo a GitHub (acción de Franco): `git remote add origin
https://github.com/Franco944796/juego_estrategia.git` y `git push -u origin main`. Repo público:
   falta decidir la licencia (todos los derechos reservados o PolyForm Noncommercial) y el nombre para
   el copyright.
3. Varias ligas con ascensos y descensos entre temporadas.

## Comandos

- `pnpm install` · `pnpm check` (lint + typecheck + tests) · `pnpm coverage`
- `pnpm sim --bots 8 --seed 1 --runs 5 [--write]`
- `pnpm build:demo` → `demo/shattered-isles.html` · `pnpm e2e` · `pnpm dev`
- `pnpm serve` → mundo en línea en `http://localhost:8787` (datos en
  `apps/server/data/shattered-isles.db`; borrarlo reinicia el mundo)

## Problemas conocidos

- Balance de la demo: tensión PvP 0,40, justo en el borde del objetivo (0,2–0,4). Detalle en
  `docs/BALANCE.md`.

## Notas del motor (no obvias en el código)

- El estado solo cambia en comandos y eventos programados; `advanceTo` no acumula hasta `now`.
  Las vistas y validaciones usan proyecciones con la misma aritmética, así un replay da el mismo
  hash.
- La misión de una marcha se decide al llegar: si el pueblo es propio, refuerza; si no, ataca.
- El factor de viento queda fijo al salir la marcha.
