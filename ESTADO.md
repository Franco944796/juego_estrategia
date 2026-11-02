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
  - la demo offline va ×20 y con bots; desde el 2026-11-02 sus capitales tampoco se pueden atacar.
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

## Hecho en la etapa «ligas» (2026-11-02, en línea)

Decisiones de Franco (vigentes):

- 3 ligas (Bronce, Plata, Oro), cada una con su mundo, mapa y ranking, en el mismo servidor. Todos
  empiezan en Bronce. Solo en línea; la demo es liga 1.
- Al terminar la temporada: Bronce → sube el 100 % de los que jugaron; Plata → sube el mejor 50 %,
  el resto se queda (no se baja de Plata); Oro → se queda el mejor 50 %, el peor 50 % baja a Plata.
- Reglas de juego iguales en las tres (recuperación 90 % fija en todas).
- Legado por puesto: Plata ×1,5, Oro ×2.
- Faros de zona en la demo: se deja como está (0,63); sale de pendientes.

Mías (avisadas): temporadas de las tres ligas sincronizadas (empiezan y terminan juntas); quien no
juega una temporada conserva su liga; chat global y clanes compartidos entre ligas (aliados solo
dentro del mismo mundo); salón de la fama por liga.

Hecho: un `WorldService` por liga (`league` en cuentas y temporadas, con migración), rutas por
liga, `leagueMoves` y Legado ×liga en `rewards.ts`, medallas con liga; cliente con liga en la cuenta,
el ranking, el salón de la fama y el aviso de fin de temporada. Verificado: 218 tests, 24 de
Playwright, revisión visual de la cuenta. Para empezar de cero: borrar
`apps/server/data/shattered-isles.db` (igual migra sola: la temporada vieja pasa a Bronce).

## Mundo en línea más rápido (2026-11-02)

- Franco pidió ×5 de oro y tropas en lo que prueba en el celular (`pnpm serve`): el preset en línea
  usa la producción por minuto de la demo; costos ×40 igual. Nivel 100 en ~2,3 días (antes 5,4),
  primera conquista a los ~19 min. La temporada en curso guarda su configuración: para verlo hay
  que borrar `apps/server/data/shattered-isles.db` con el servidor apagado.

## Hecho: capitales inatacables y aparición al azar (2026-11-02, demo y en línea)

- Decisiones de Franco: ninguna capital se puede atacar (demo y en línea) y lleva un escudo en el
  mapa; la capital nace en un pueblo neutral al azar, entre el 25 % más alejado de las otras
  capitales (`map.spawn.farShare`); sus 3 vecinos neutrales más cercanos pasan a ser privados.
- Mías (avisadas): capital y privados salen de su zona; los privados vuelven a nivel 1 con guarnición
  de nivel 1; sin pueblo neutral libre se aparece en la costa como antes.
- `COMO-PROBAR-EN-EL-CELULAR.txt` en la raíz: demo en un archivo o servidor en la red de la casa.
- Verificado: 210 tests unitarios, 24 de Playwright (las pruebas en línea y de clanes usan el mapa 2D
  para no ser lentas; el 3D lo cubren el recorrido y la prueba de humo), revisión visual de escudos
  y capitales tierra adentro. Sim: demo 6/7 + n/a (faros 0,63), en línea 6/7 + n/a.

## Hecho en la etapa «3D» (2026-11-02, demo y en línea)

Decisiones de Franco (vigentes):

- Investigación profunda antes de elegir la librería 3D (tabla y recomendación antes de programar).
- Cámara inclinada tipo maqueta: arrastrar para moverse, pellizcar para acercar; sin girar.
- Ciudades por etapas con el número de nivel encima: choza (1–9), casa con cerco (10–29), aldea con
  torre (30–59), fuerte (60–89), ciudadela (90–99) y castillo completo en el nivel 100.
- Una sola isla en demo y en línea (apagar el nacimiento de islas por configuración).
- Estilo low poly colorido; modelos hechos por código (sin archivos, la demo sigue siendo un HTML).
- El mapa 2D queda como opción en el menú; el 3D es el mapa por defecto.
- Marchas: grupito de figuras con estandarte del color del dueño y la cantidad encima.
- Librería: **Three.js directo** (WebGLRenderer), elegida tras la investigación del 2026-11-02:
  más liviana (escena medida: 543 KB min / 134 KB gzip; r3f +243 KB gzip, Babylon 344, PlayCanvas
  504), MIT, r187 del 30-10-2026. Contras: código imperativo; WebGL sin funciones grandes nuevas.
- Marchas visibles para todos en tiempo real (quién, desde, hacia). Cantidad: el dueño la ve exacta,
  el atacado ve un rango de un dígito (10–100, 100–1K, 1K–10K…), el resto no la ve.

Mías (avisadas): cámara que abre 2,4× más cerca que el 2D y deja acercar hasta zoom 8; árboles,
nubes y acantilados de decoración; rango con sufijos («100–1K»); avisos del servidor con 0 tropas para
marchas ajenas; métrica de viento «n/a» con una sola isla.

Hecho:

- Motor: todas las marchas visibles (salvo hacia pueblos privados ajenos), `troops` solo del dueño,
  `troopRange` para el atacado (total del grupo); `map.growth.enabled` (apagado).
- Cliente: `src/map3d/` (`camera3d.ts`, `models.ts`, `world3d.ts`, `overlay3d.ts`), `projector.ts`,
  `MapCanvas.tsx` con gestos comunes 2D/3D, opción de mapa en el menú (guardada en el navegador),
  vuelta automática al 2D sin WebGL. Demo: 1,15 MB (314 KB gzip).
- Verificado: 209 tests unitarios (motor 99,6 % de líneas), 24 de Playwright (3D en Chromium sin
  pantalla), revisión visual de las 6 etapas, el castillo, marchas, vuelo entre islas y 2D.
- Sin verificar: rendimiento en un celular real. Para probar sin servidor: pasar
  `demo/shattered-isles.html` al celular y abrirlo.

## Hecho en la etapa «agrupar tropas y marchas» (2026-11-01, demo y en línea)

Decisiones de Franco (vigentes):

- Agrupar: desde la ficha de cualquier ciudad («Reunir tropas acá» / «Ataque agrupado») se eligen
  ciudades propias; vienen marcadas las 5 más cercanas con tropas; cada una manda todas sus tropas.
- Ataque sincronizado: salen todas ya, llegan con la más lenta y pelean como un solo ejército.
- Límite de 10: solo ataques en camino (un grupo = 1); a ciudades propias siempre se puede mandar.
- Duración: distancia y tropas; ≤ 9 tropas cruzan la isla en ~10 s reales; +500 % por cada dígito
  más (100 ×11, 1M ×31, 1T ×61). Mismos segundos reales en la demo y en línea.

Mías (avisadas): velocidad aérea en la misma proporción que antes; duraciones de marcha como métricas
informativas del simulador; en Marchas y en el contador del botón un grupo se ve como una sola marcha.

Hecho:

- Motor: `troopSlowdown`, `launchGroup`, llegada conjunta en `arriveMarch`, `activeAttacks`, orden
  `SEND_GROUP`, `previewGroup`; `March.groupId` y `March.attack`; `STATE_VERSION` 4.
- Servidor y cliente: mensaje `previewGroup`, `GroupSheet.tsx`, botón en la ficha, marchas agrupadas.
- Verificado: 199 tests unitarios (motor 99,6 % de líneas), 20 de Playwright, revisión visual (lista
  de grupo y marchas en celular y escritorio). Sim: demo 7/8, en línea 6/8 (ver problemas).

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
- Un jugador activo en línea llegaba a nivel 100 en ~1 semana; desde el 2026-11-02 (producción ×5)
  en ~2–3 días. En la demo, a mitad de temporada.
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

1. Bots que crucen a islas nuevas; después volver a prender el nacimiento de islas
   (`map.growth.enabled`).
2. Equipo nuevo (pedido 2026-11-02): más oro al matar tropas (atacando y defendiendo) y un % del oro
   invertido que se recupera al perder una ciudad (ej.: invertidos 10T con el máximo, 50 %, se
   recuperan 5T).
3. Poder (pedido 2026-11-02): ciudades y tropas con un valor de «poder» por señor. Atacar a alguien
   con el doble o más de tu poder da ×2 de exp; atacar a alguien con «64 % menos» de tu poder da 50 %
   menos de exp; no se puede atacar a quien tiene «65 % de tu poder o menos». Aclarar al empezar: los
   dos umbrales se superponen (64 % menos = 36 % de tu poder, que ya queda prohibido).

Hecho por Franco (2026-11-02): probó el 3D en el celular, abrió el puerto 8787 y subió el repo a
GitHub (`Franco944796/juego_estrategia`, licencia PolyForm Noncommercial 1.0.0).

## Comandos

- `pnpm install` · `pnpm check` (lint + typecheck + tests) · `pnpm coverage`
- `pnpm sim --bots 8 --seed 1 --runs 5 [--write]`
- `pnpm build:demo` → `demo/shattered-isles.html` · `pnpm e2e` · `pnpm dev`
- `pnpm serve` → mundo en línea en `http://localhost:8787` (datos en
  `apps/server/data/shattered-isles.db`; borrarlo reinicia el mundo)

## Problemas conocidos

- Balance (detalle en `docs/BALANCE.md`): tensión PvP baja (demo 0,17, en línea 0,06; objetivo
  0,2–0,4); con 90 % de recuperación las ciudades cambian de dueño muchísimo; señores y ciudades
  llegan a nivel 100 bastante antes del fin de temporada; en línea los bots nunca cruzan a la
  segunda isla (las ciudades enemigas de nivel alto valen más que los neutrales de nivel 1–3).
- Tropas por encima de ~9·10¹⁵ pierden unidades por precisión de los números (determinista igual).

## Notas del motor (no obvias en el código)

- El estado solo cambia en comandos y eventos programados; `advanceTo` no acumula hasta `now`.
  Las vistas y validaciones usan proyecciones con la misma aritmética, así un replay da el mismo
  hash.
- La misión de una marcha se decide al llegar: si el pueblo es propio, refuerza; si no, ataca.
- El factor de viento queda fijo al salir la marcha.
