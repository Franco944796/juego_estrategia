# ESTADO — juego_estrategia (Shattered Isles; antes prueba_ML)

## Objetivo

- Juego **original** de conquista en tiempo real, mobile-first, en islas flotantes («Shattered Isles»).
- El prompt de origen pedía replicar Million Lords con otro nombre: esa parte se rechazó. Del prompt se
  reusa solo el nombre, el lore liviano, el stack y la vara de calidad.
- Esta etapa: motor determinista + bots + demo para un jugador en un único HTML offline.

## Decisiones tomadas (2026-10-30)

- Diseño original «Vientos y 3 tropas» (detalle vigente en `docs/DESIGN.md`):
  - viento rotativo con pronóstico; entre islas: a favor ×2, cruzado ×1, en contra ×0,5;
  - desde el 2026-11-01 hay un solo tipo de tropa (se quitaron los tres tipos y sus contras);
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
- Git: los commits y el push los hace Franco; Claude no commitea (decidido de nuevo el 2026-11-01).
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

- Nada. Próxima etapa: la que elija Franco de «Pendiente» (preguntar antes de empezar).

## Hecho en la etapa «perfil, botones y equipo» (2026-11-01, demo y en línea)

Decisiones de Franco (vigentes):

- Columna de botones con imágenes a la derecha (marchas, informes, ranking, social en línea, menú); sin
  barra abajo.
- El retrato del HUD (nivel del señor) abre el perfil con solapas Equipo, Habilidades y
  Estadísticas; sin botón aparte para habilidades.
- 6 ranuras: arma = ataque; armadura = defensa de las tropas; casco = muros; capa = producción de
  tropas; botas = velocidad de marcha; anillo = oro. 4 rarezas: +3/+6/+10/+15 %.
- 1 objeto cada 5 niveles del señor y tienda con Legado (en línea). Todos los objetos son
  permanentes (cambia la regla de que el Legado solo compraba estilos).

Mías (avisadas): precios 20/50/120/300 de Legado; rareza al azar con más chances de las buenas a
mayor nivel (`gear.dropOdds`); en la demo el equipo se guarda en el navegador y pasa a la partida
siguiente; los bots se ponen el mejor objeto de cada ranura; en el celular los puntos sin repartir se
ven en el retrato; la sección de la cuenta en el menú pasó a llamarse «Cuenta».

Hecho:

- Motor: `gear.ts` (objeto al subir de nivel, `grantItem`, mejor objeto para bots), orden `EQUIP`
  (R16 `NO_ITEM`), efectos en `modifiers.ts` (defensa por contingente, muros, velocidad).
- Servidor: columnas `items` y `gear` en `accounts` (migración automática), `POST /api/items/buy`,
  registro `item` para el replay, `syncGear` copia equipo de la temporada a la cuenta.
- Cliente: `SideRail.tsx` (reemplaza `BottomNav.tsx`), retrato en `Hud.tsx`, `LordProfile.tsx`
  (equipo, tienda, habilidades, estadísticas), íconos de ranuras, textos es/en.
- Verificado: 190 tests unitarios (motor 99,6 % de líneas), 18 de Playwright, revisión visual
  (equipo y estadísticas en celular y escritorio, columna con 5 botones sin tapar el panel). Sim:
  demo 7/10, en línea 7/10; nivel 100 a los 176 min (demo) y 6,8 días (en línea).

## Hecho en la etapa «economía y combate» (2026-11-01, demo y en línea)

Decisiones de Franco (vigentes):

- Un solo tipo de tropa. Ciudades propias sin tope de tropas; neutrales regeneran hasta su guarnición.
- Ciudades hasta nivel 100. Todo lo que crece con el nivel usa una escala (×2,5 en nivel 2, ×5·10¹¹
  en nivel 100, salta más al principio). Muros: 20 en nivel 1 → 10T en nivel 100, se suman a la
  defensa; fortificación +5 % por nivel desde 0; capital y cerca de capital conservan su bonus.
- Neutrales de nivel 1 a 3. Números grandes con K, M, G, T.
- Un jugador activo en línea llega a nivel 100 en ~1 semana (en la demo, a mitad de temporada).
- Habilidades: 1 punto por nivel del señor, fijos, se reinician cada temporada; oro, tropas y ataque
  +5 % por punto. «Atacante» y «defensor» = % de bajas que vuelven a la capital; liga 1: 90 % fijo.
- Matar una tropa: 5 exp y 5 oro atacando, 3 y 3 defendiendo. Sin edictos ni gloria.
- Mías (avisadas): se quitaron los premios viejos por nivel; las bajas recuperadas van a la capital (si
  no hay, a la ciudad de mayor nivel); los neutrales no recuperan; matar neutrales también da
  recompensa; conquistar ya no da experiencia; botón «Hasta nivel N» para subir varios niveles de una;
  pestaña abajo «Skills» (no entra «Habilidades» en el celular).

Hecho:

- Motor: tropas = número; `combat.ts` con muros; `economy.ts` (`levelScale`, `wallsAt`, `upgradePlan`);
  `skills.ts`; recuperación y recompensas en `marches.ts`; orden `LEARN_SKILL` (R13) y `UPGRADE` con
  `levels`; R06 retirada; `STATE_VERSION` 3 (servidor y demo descartan partidas viejas).
- Cliente: envío con una sola barra (porcentaje), ficha con muros/producción/«Hasta nivel N», panel de
  habilidades, informes con tropas recuperadas y exp/oro, nivel dibujado dentro de cada ciudad,
  tasas grandes con sufijos (`formatRate`).
- Config: demo `upgradeCost` 8; en línea costo ×40 y 400 de oro inicial.
- Verificado: 176 tests unitarios (motor 99,5 % de líneas), 16 de Playwright, revisión visual
  (habilidades, ciudad nivel 40→55, envío, informe de defensa). Sim: demo 8/10, en línea 6/10.
- Decisión pendiente para Franco: faros de zona raros en la demo (0,49 de los señores; en línea ya
  da 0,96). Opciones: zonas más chicas o bonus de defensa en zonas con faro.
- Probar en línea desde cero: `rm apps/server/data/shattered-isles.db` y `pnpm serve`.

## Hecho en la etapa «islas grandes» (2026-11-01, demo y en línea)

- Marchas ×10 (tierra 350, aire 450, mínimo 0,05 min); sin Trono (`throne.enabled: false`, se puede
  reactivar por config).
- El mundo empieza con 1 isla de 100 ciudades en espiral (nivel 3 al centro, después 2 y 1), 10 zonas
  con faro propio y 10 lugares de aparición en la costa (`packages/engine/src/mapgen.ts`).
- Cada jugador aparece con capital nueva + 3 ciudades privadas que solo él ve y ataca hasta que
  tienen dueño (`spawn.ts`; R14 `UNKNOWN_TOWN`; la vista las oculta a los demás).
- Isla nueva cuando la última está llena o sin ciudades públicas neutrales, máximo 3 cada 24 h
  (`growth.ts`, evento `GROW_CHECK`); si no hay lugar, `WORLD_FULL`.
- Defensa extra cerca de la capital por radio (`towns.homeFort` / `homeRadius`); exilio en la isla
  más nueva; bots limitados a objetivos cercanos y a sus pueblos más fuertes (simulación en línea de
  ~150 s a ~35 s por temporada).
- Servidor: una temporada guardada con `STATE_VERSION` viejo se marca `abandoned` y arranca otra.
  Demo: las partidas guardadas viejas se ignoran.
- Cliente: `townById`, faros por zona (brillo del dueño), pueblos privados con borde punteado, ficha
  con progreso del faro de la zona, HUD sin Trono, textos de ayuda.
- Verificado: 176 tests unitarios (cobertura del motor 99,6 % de líneas), 14 de Playwright, revisión
  visual del mapa en celular y escritorio. Simulador: demo 9/10, en línea 9/10.

## Economía en línea y HUD (2026-11-01)

- Mundo en línea: producción ÷5 respecto de la demo y botín ×5 (costos y niveles: ver «economía y
  combate»).
- HUD: oro, Dominio y nivel del señor con barra de experiencia.

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

- `apps/client/e2e/tour.spec.ts` arma partidas guardadas con el motor (puntos de habilidad, ciudad
  grande, ataque entrante, pueblo enemigo y vuelo entre islas, fin de temporada) y saca capturas en
  celular y escritorio, con control de desbordes y texto cortado.
- Corregido: etiquetas de guarnición tapadas por pueblos vecinos (dibujo en dos pasadas); la pista
  «si esperás el viento» solo aparece si así llegás antes; el cierre dice «X gana la temporada».

## Balance de la demo (2026-11-01)

- Demo con los mismos frenos que el mundo en línea, más suaves (cerca de la capital ×1,5; −5 % por
  pueblo pasados 8). `pnpm sim` usa 12 corridas por defecto en la demo. Registro en
  `docs/BALANCE.md`.
- Corregido: al elegir destino la cámara centra el pueblo de origen (antes algunos destinos quedaban
  debajo de la burbuja del tutorial y el toque no llegaba; el test fallaba a veces); cartel de
  «elegí destino» en una línea; el test en línea ya no supone un mundo vacío.
- La carpeta se renombró a `juego_estrategia`; el workspace de VS Code apunta a la ruta nueva.

## Pendiente

Preguntar a Franco los detalles al empezar cada uno:

1. Agrupar tropas: al tocar una ciudad, elegir de qué ciudades recibir tropas, con las cercanas
   preseleccionadas.
2. Marchas más lentas según la distancia entre ciudades.
3. Juego en 3D, con ciudades como chozas bien detalladas; por ahora una sola isla para probar
   (Franco agrega más cuando todo funcione).
4. Abrir el puerto 8787 en el firewall para jugar desde el celular (acción de Franco):
   `sudo firewall-cmd --add-port=8787/tcp` (con `--permanent` para que quede).
5. Subir el repo a GitHub (acción de Franco): `git remote add origin
https://github.com/Franco944796/juego_estrategia.git` y `git push -u origin main`. Repo público
   con licencia PolyForm Noncommercial 1.0.0 (`LICENSE.md`, copyright Franco944796).
6. Varias ligas con ascensos y descensos (en ligas superiores, «atacante» y «defensor» con puntos).

- Decisión pendiente: faros de zona raros en la demo (zonas más chicas o bonus de defensa).

## Comandos

- `pnpm install` · `pnpm check` (lint + typecheck + tests) · `pnpm coverage`
- `pnpm sim --bots 8 --seed 1 --runs 5 [--write]`
- `pnpm build:demo` → `demo/shattered-isles.html` · `pnpm e2e` · `pnpm dev`
- `pnpm serve` → mundo en línea en `http://localhost:8787` (datos en
  `apps/server/data/shattered-isles.db`; borrarlo reinicia el mundo)

## Problemas conocidos

- Balance (detalle en `docs/BALANCE.md`): tensión PvP baja (demo 0,17, en línea 0,06; objetivo
  0,2–0,4); con 90 % de recuperación las ciudades cambian de dueño muchísimo; señores y ciudades
  llegan a nivel 100 bastante antes del fin de temporada; menos de la mitad de los vuelos esperan
  viento a favor (demo 0,49, en línea 0,38).
- Tropas por encima de ~9·10¹⁵ pierden unidades por precisión de los números (determinista igual).

## Notas del motor (no obvias en el código)

- El estado solo cambia en comandos y eventos programados; `advanceTo` no acumula hasta `now`.
  Las vistas y validaciones usan proyecciones con la misma aritmética, así un replay da el mismo
  hash.
- La misión de una marcha se decide al llegar: si el pueblo es propio, refuerza; si no, ataca.
- El factor de viento queda fijo al salir la marcha.
