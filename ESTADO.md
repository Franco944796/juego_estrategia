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

## Hecho: islas nuevas, bots que cruzan y puentes de luz (2026-11-06; sin commitear)

Decisiones de Franco: cruce según personalidad; crecimiento de islas en línea y un jugador; rutas 3D
como puente de luz rúnico; verificar con simulador + prueba.

- Config: `map.growth.enabled: true`; por personalidad `crossFreeShare` (mira otras islas cuando la
  parte de neutrales públicos libres de su isla es ≤ esto) y `crossWeight` (peso de esos objetivos):
  Saqueador 1/×20, Escalador 0,2/×1, Constructor 0/×1, Guardián 0/×0,01; `bots.crossSlack` 1,5 (al
  cruzar manda lo que pide el asedio ×1,5, no toda la guarnición: las marchas grandes vuelan lento).
- Motor: `bots.ts` (`freeShare`, `crossFactor`, tropas justas al cruzar). Pruebas nuevas en
  `bots.test.ts` (cruza con tropas justas; el Constructor no cruza con libres en casa); la de niebla
  usa un Saqueador; `join.test.ts` apaga el crecimiento a mano en la prueba de mundo lleno.
- Simulador: métrica «Lords who took a town on another isle». Un jugador (6 semillas): Saqueadores
  12/12 desde el 15 % de la temporada, Constructores 10/12 desde el 33 %, Guardianes 6/12 después del
  74 %; 0,74 de los señores cruzan, 2,8 islas, tensión 0,18 (era 0,20). En línea: 8 islas, todos
  cruzan en el primer 4 %, 66 ciudades por señor a mitad de temporada (ver etapa de equilibrio).
- Cliente 3D: `map3d/bridges.ts` (cinta en arco entre costas, runas que corren, celeste de las
  piedras rúnicas en reposo; al enviar, las de la isla de origen toman el color del viento) y etiqueta
  «×factor» en la cima (`overlay3d.ts`, `World3D.bridgeTop`). La niebla se aleja con la cámara
  (`fitFog`): antes, al alejarse para ver varias islas, desaparecían.
- Verificado: lint, tipos, 241 tests, simulador, revisión visual en escritorio (envío y vista lejana).

## Hecho: gemas del equipo (2026-11-06; sin commitear)

Decisiones de Franco:
- Engarces por rareza: común 0, raro 1, épico 4, legendario 9.
- Cada gema suma según su color: topacio +% oro, rubí +% tropas, zafiro +% defensa, amatista +%
  Dominio, esmeralda +% experiencia.
- La calidad depende de la liga donde se ganó: Bronce 2,5 %, Plata 5 %, Oro 10 % (y así, el doble
  por liga).
- Suben de nivel con copias como el equipo (misma gema = mismo color y liga; 2 × nivel copias),
  hasta nivel 10; cada nivel suma la mitad de su valor base.
- Premio al cerrar la temporada, según el puesto: 5 % superior 5 gemas, hasta 25 % 3, hasta 50 % 2,
  resto 1; color al azar, calidad de la liga. Se sacan y ponen libremente; destruir un objeto
  devuelve sus gemas a la bolsa.

Mías (avisadas): las gemas suman solo en piezas puestas; amatista multiplica el Dominio por minuto
y esmeralda la experiencia de las batallas (modificadores nuevos `dominion` y `xp`); en el modo un
jugador el premio se calcula al terminar la temporada (`SEASON_ENDED`), se guarda en
`shattered-isles:gem-rewards` y se suma a la bolsa al empezar la siguiente; en línea lo reparte el
servidor al cerrar (color con `random`, id `temporada-liga-cuenta-n`); una gema en nivel 10 no
toma más copias (queda aparte).

Hecho: config `gear.sockets`, `gems.maxLevel/levelShare`, `leagues[].gemBonus`,
`rewards.tiers[].gems`; `GEM_COLORS`; `Gem`, `Item.gems`, `Lord.gems`; `gems.ts` (`gemValue`,
`stockGem`, `gemBonuses`); órdenes `SOCKET_GEM`/`UNSOCKET_GEM` (R20: NO_GEM, GEM_IN_USE,
NO_SOCKET); servidor: columna `gems`, premio por puesto, `Reward.gems`; cliente: engarces en la
pestaña Equipo (tocar una gema la saca, selector para poner), total de gemas, avisos de fin de
temporada. Verificado: lint, tipos, 239 tests (`engine/test/gems.test.ts`, premios en
`server/test/world.test.ts`), 29 de Playwright (poner y sacar gema; premio del modo un jugador),
revisión visual en celular.

## Hecho: equipo con niveles, dragón solo en la capital, confirmar habilidades (2026-11-06; sin commitear)

Decisiones de Franco:
- Dragón: solo sobre la capital de nivel 100 (posado, a veces vuela una vuelta); los demás
  castillos de nivel 100 quedan sin dragón.
- Sumar un punto de habilidad pide confirmación.
- Equipo: duplicado (misma pieza y rareza) = copia; con 2 copias sube a nivel 2, 4 más a nivel 3,
  6 más a nivel 4… Destruir da sobrantes (común 10, raro 25, épico 60, legendario 150, + la mitad
  de lo puesto). Mejorar con sobrantes: 20 × nivel. Cada nivel suma común +1 %, raro +2 %, épico
  +3 %, legendario +5 %; tope nivel 20. El cofre no sube de nivel.

Mías (avisadas): no se destruye un objeto puesto; destruir pide confirmación; un cofre repetido o
un repetido de un objeto en nivel 20 queda como objeto aparte (para destruirlo); los sobrantes se
guardan en la cuenta (columna `scrap`) o en el navegador (armería); la cuenta de prueba mejora
gratis y ve ∞ sobrantes.

Hecho: config `gear.levelBonus/maxItemLevel/copiesPerLevel/scrapByRarity/upgradeScrap`;
`Item.level/copies/scrap`, `Lord.scrap`; `stockItem`, `destroyScrap`, `upgradeScrapCost` en
`gear.ts`; órdenes `DESTROY_ITEM` y `UPGRADE_ITEM` (R19: ITEM_EQUIPPED, CHEST_FIXED,
MAX_ITEM_LEVEL, NO_SCRAP); eventos ITEM_DESTROYED/ITEM_UPGRADED, `ITEM_FOUND.into`; servidor:
`syncGear` copia la lista entera y los sobrantes a la cuenta, la tienda apila copias; cliente:
pestaña Equipo con sobrantes, nivel y copias, Mejorar y Destruir. Verificado: lint, tipos, 235
tests (`engine/test/items.test.ts`, `server/test/items.test.ts`), 29 de Playwright (recorrido de
equipo con destruir y mejorar; habilidades con confirmar y cancelar), revisión visual en celular.

## Hecho: sistema de diseño del artefacto (2026-11-06)

Segunda tanda (versión 1793982415-cefa, decisiones de Franco): dragón solo en la capital de nivel
100; sección «Equipo» (copias, sobrantes, niveles); componente nuevo FichaObjeto (rareza con un
cuadradito con contorno, porque esos colores no llegan a 4,5:1 como texto sobre el pergamino);
principio 7 «Lo que no se deshace, se confirma» y su clase `si-confirmar`. Revisión visual de
FichaObjeto en los dos temas.

Tercera tanda (versión 1793985351-8c4a, aprobada por Franco): sección «Gemas» completa (engarces
0/1/4/9, efecto por color, valor por liga, niveles por copias hasta 10, premio 5/3/2/1, se ponen y
sacan libres); FichaObjeto con fila de engarces (`si-engarces`, `si-gema-nivel`,
`si-engarce-libre`) y selector; formato de nombre de gema en «Voz». Revisión visual en los dos temas.

Artefacto: https://claude.ai/artifact/MyxD3JV2Q8pTP6F8TMdaad («Reino Pintado», tipo Design System).
Franco pidió adaptarlo a lo decidido, preguntando cada cambio. Decisiones:

1. Renombrar a «Shattered Isles» y quitar la mención a Million Lords (estilo propio).
2. MarcadorCiudad con las 6 etapas del juego y el dragón en el nivel 100; principio «El dragón
   corona el nivel 100».
3. Gemas: 5 tokens, regla «una gema por dato», BarraRecursos con gemas; gemas del equipo: en la tercera tanda.
4. Color de dueño como el juego: cada señor su color (8), neutral gris, aliado anillo celeste,
   amenaza roja para lo que viene contra vos.
5. Personajes: señores humanos con heráldica + dragones (sin animales antropomórficos).
6. Tema según la hora del día: «Pergamino» de día y «Noche de las islas» (azul noche, oro, gemas)
   de noche, automático. Después: hacer lo mismo en el juego.
7. Mundo: islas flotantes, mar de nubes, costa irregular, cascadas, montañas nevadas, lagos,
   cristales, runas, faros arcanos, territorios, viento; tokens de terreno nuevos.
8. Cinzel + Nunito; después sumarlas al juego (archivos servidos por el servidor).
9. Íconos nuevos: dragón, explorar (catalejo), gema, faro arcano.
10. FichaTropa por misión (espada ataque, escudo refuerzo, catalejo exploración), amenaza en rojo,
    grupo con cantidad de ciudades, rango para tropas ajenas.
11. «Qué evitar»: se permite el degradado azul noche sutil; nada de violeta/neón ni cristal.
12. Voz con textos reales del juego, voseo.

Hecho y publicado (versión 1793970879-9b6a): README, tokens (72: temas Pergamino/Noche de las
islas, 12 colores de señor, aliado, amenaza, 5 gemas, terreno), bundle.css (prefijo `si-`), los 5
componentes y la portada; íconos nuevos subidos (dragón, catalejo, gema, faro). Revisión visual de
los previews en los dos temas con un armado local. El nombre de la pestaña del artefacto sigue
«Reino Pintado»: se cambia desde la página (las herramientas no renombran artefactos de tipo).

Llevado al juego (2026-11-06, sin commitear): tema según la hora (`src/theme.ts`: Pergamino de
7:00 a 18:59 hora local, Noche de las islas el resto; `localStorage['shattered-isles:theme']`
lo fuerza, solo para pruebas y capturas; variables en `styles.css` con contrastes medidos ≥ 4,5:1),
fuentes Cinzel 700 y Nunito variable (Fontsource, OFL, solo latín, dentro del HTML: +65 KB gzip;
`src/fonts.css`), íconos oscuros dentro de las gemas. Revisión visual del tema de día en celular y
escritorio (portada, ficha, perfil, menú).
## Hecho: cuentas de prueba y sin HTML de demo (2026-11-06; sin commitear)

Decisiones de Franco: recursos de prueba por cuenta (no por IP); oro infinito, tropas, niveles y
Legado infinito; la cuenta de prueba queda fuera del ranking, del Legado, de las medallas y de los
cambios de liga; se borró solo `demo/shattered-isles.html` (el modo un jugador sigue en la app).

- Cómo se usa: copiar el código de recuperación (Menú → Cuenta) en
  `apps/server/data/dev-accounts.txt` (uno por línea, `#` comenta; ya está creado con
  instrucciones), y volver a entrar al mundo. El servidor relee el archivo cuando cambia. Otra ruta:
  variable `DEV_ACCOUNTS`.
- Qué da: mejoras gratis (oro ∞ en el HUD, «Hasta nivel 100»), +1M / +1T tropas en la ficha de
  una ciudad propia, +1 / +10 niveles / nivel máximo en el menú, tienda de Legado y estilos gratis.
- Mías (avisadas): el motor marca al señor con `Lord.dev` (orden `ENABLE` registrada en el log, así el
  replay la repite) y lo saca de `computeStandings`, por eso queda fuera de recompensas, clanes y
  salón de la fama; si el código se borra del archivo, al reconectar vuelve a ser normal (lo ya
  ganado queda).
- Motor: `dev.ts` (`devAction`: ENABLE, TROOPS, LEVELS). Servidor: `devAccountsPath`, mensaje `dev`
  por WebSocket, log `dev`, Legado gratis. Cliente: `devTool`, botones en ficha y menú.
- Sin demo: `pnpm build` (antes `build:demo`) deja el cliente en `apps/client/dist/index.html`; las
  pruebas de Playwright lo abren desde ahí; se borró `apps/client/scripts/copy-demo.mjs`.
- Verificado: lint, tipos, 229 tests (`engine/test/dev.test.ts`, `server/test/dev.test.ts`), 29 de
  Playwright (prueba nueva en línea con cuenta de prueba), revisión visual (menú y ficha en celular).

## Hecho en la etapa «fantasía y dragones» (2026-11-06, demo y en línea; sin commitear)

Decisiones de Franco: dragón solo visual en los castillos nivel 100; «máscaras» = skins 3D por estilo
cosmético; cristales y runas, cascadas al vacío, faros arcanos; interfaz con una gema por dato
(oro = topacio, tropas = rubí, defensa = zafiro, Dominio = amatista, experiencia = esmeralda).

Mías (avisadas): el dragón (del color del dueño, 1,6 veces la escala del castillo) descansa sobre el
torreón abierto, cada 32 s despega, da una vuelta de radio 40 y vuelve; el castillo perdió la bandera
de arriba (ahí está el nido). Skins: Clásico, Torre (pizarra), Hexágono (arenisca), Diamante (mármol y
oro), Estrella (piedra clara y madera verde), Cristal (obsidiana con cristales); los techos siguen con
el color del dueño. Faros: obelisco con bandas de runas que brillan y cristal flotante que gira.
Hasta 3 arroyos por isla terminan en cascada; piedras rúnicas junto a ~22 % de los caminos; cristales
en montañas. Interfaz: gemas facetadas en HUD, ficha por secciones (Defensa, Producción, Reino),
habilidades y columna lateral; esquinas doradas en paneles.

Hecho: `models.ts` (paleta por skin `SKINS`, `buildStages(style)`, `buildDragon`, faro arcano,
`buildBeaconCrystal`, `DRAGON_PERCH`, anim de 3 canales), `animate.ts` (aleteo con `flap` por
instancia), `world3d.ts` (sets de ciudades por estilo creados al vuelo, vuelo del dragón, cristales de
faros, agua que corre), `terrain.ts` (arroyos y cascadas, cristales, runas), 2D con cascadas,
`ui/Gem.tsx` y estilos. Verificado: lint, tipos, 226 tests, 28 de Playwright, revisión visual (skins,
dragón posado y en vuelo, faros, cascada, ficha y HUD).

## Hecho: exploración y costa irregular (2026-11-06, demo y en línea; sin commitear)

- Barra de envío de a 10 % (redondeo hacia abajo, mínimo 1); su primera posición explora.
- Decisiones de Franco: explorar no ataca, solo informa (tropas, muros, % de defensa, total); la tropa
  se pierde al mirar; el dueño recibe «X exploró Y» sin detalle; sin límites (no cuenta para el tope
  de 10, vale contra capitales, neutrales y débiles); velocidad normal de 1 tropa. Costa realista.
- Mías (avisadas): botón «Explorar» en la ficha de toda ciudad ajena (abre el envío en la posición de
  explorar); explorar una ciudad propia o aliada se rechaza (R18 `NOT_FOREIGN`); la marcha
  exploradora se ve en el mapa pero no cuenta como ataque entrante; los informes de ataque también
  muestran el desglose de la defensa (`BattleReport.defenseMult`, opcional).
- Motor: orden `SCOUT`, `March.scout`, `ScoutReport` en `state.scouts` (`migrateState` lo agrega a
  partidas viejas, sin subir `STATE_VERSION`), evento `SCOUTED`, `LordView.scouts`. Servidor: esquema
  y filtro de eventos (al explorado le llegan los números en 0).
- Costa: `IsleField.coastline()` (bahías, calas, borde irregular sobre la forma del motor; las
  ciudades empujan la costa para tener 26 de tierra firme); agua de lagos recortada a la costa.
- Verificado: lint, tipos, 226 tests (`scout.test.ts`), 28 de Playwright (prueba nueva de explorar
  una capital), revisión visual (ficha, informe, costa 3D y 2D). La prueba de humo tiene 180 s de
  límite (con todo en paralelo pasaba los 90).

## Hecho en la etapa «territorios y biomas» (2026-11-06, demo y en línea; sin commitear)

Franco pidió algo parecido a la textura de Million Lords: no se copia su aspecto (decisión del
2026-10-30); se tomaron ideas generales del género, con estilo propio. Decisiones de Franco:

- Territorio del dueño (suelo teñido y borde donde se toca con otro dueño), en 3D y en 2D.
- Biomas variados: montañas con roca y nieve, lagos, praderas secas, bosques densos.
- Colores más saturados y contornos más definidos.

Mías (avisadas): territorio = celda de Voronoi de cada ciudad hasta 24 de radio; las neutrales no se
tiñen; se repinta solo cuando cambia un dueño o un color; contorno (casco invertido) en ciudades y
faros, solo Alta y Media; montañas y lagos solo lejos de ciudades y caminos (quedan en la franja
silvestre cerca de la costa); en 2D, sombreado de relieve.

Hecho: `map3d/territory.ts` (textura de territorios, grilla de búsqueda), mezcla en el shader del
suelo (`withTerritory` en `terrain.ts`), montañas/lagos/paleta en `IsleField.height` y
`paintGround`, plano de agua por isla (`WATER_LEVEL`), contornos (`Model.outline`, `Pair`),
luz con más contraste, 2D con territorios, relieve y lagos. Verificado: lint, tipos, 224 tests,
26 de Playwright, revisión visual (alta y media en escritorio, 2D). «Baja» por software: ~15 cuadros/s.

## Hecho en la etapa «gráficos detallados» (2026-11-05, demo y en línea; sin commitear)

Decisiones de Franco (vigentes):

- Estilo «estilizado detallado» (low poly más trabajado, sigue siendo un solo HTML con modelos por
  código). Alcance: terreno y vegetación, ciudades y faros, tropas y marchas, interfaz y mapa 2D.
- Fondo (cielo y nubes alrededor y debajo de las islas): sin cambios.
- Calidad automática Alta/Media/Baja según el equipo + opción «Gráficos» en el menú (solo con mapa
  3D; clave `shattered-isles:quality`).

Mías (avisadas): «Auto» baja un nivel una vez si la mediana de cuadros pasa de ~42 ms; WebGL por
software → Baja; faros corridos a 16 de cualquier ciudad (solo en el dibujo); los anillos de selección
se dibujan encima de todo; caminos = cada ciudad con sus 2 vecinas más cercanas (< 75).

Hecho:

- `map3d/quality.ts` (presets y detección), `animate.ts` (atributo `anim`: banderas, fuego y piernas
  por shader), `terrain.ts` (relieve, textura del suelo por código, acantilado con capas, parte de
  abajo, 7 tipos de vegetación, `flatIsle` para el 2D, `beaconSpot`), `models.ts` (6 etapas con
  humo de chimenea, faro, soldado con color del dueño, estandarte), `world3d.ts` (sombras que siguen
  la cámara, humo con el viento, polvo de marchas, soldados sobre el relieve).
- 2D (`map/render.ts`): suelo pintado con copas de árboles, acantilado en capas, fichas con relieve.
- Interfaz (`styles.css`): paneles con degradé y borde dorado, botones con relieve, títulos serif,
  botones laterales tipo medallón.
- Pruebas: prueba de poder pausada (con render lento el bot recuperaba poder); el recorrido prueba la
  opción «Gráficos». Verificado: lint, tipos, 224 tests, 26 de Playwright, revisión visual (alta, media
  y baja; celular y escritorio; 2D; ficha y menú). Demo: 1,18 MB (332 KB gzip).
- Sin verificar: rendimiento en un celular real. En Chromium por software, «Baja» va a ~12–22 cuadros/s
  (antes ~24).

## Tropas al subir de nivel (2026-11-03)

- Franco: cada nivel del señor da tropas, en todos los niveles: 30 × escala del nivel nuevo en la
  capital (`levels.troopsReward`); el aviso dice cuántas llegaron.

## Hecho en la etapa «poder y equipo nuevo» (2026-11-02, demo y en línea)

Decisiones de Franco (vigentes):

- Poder de un señor = sus tropas (en ciudades, en marcha y apostadas) + los muros de sus ciudades.
- Exp por tropa matada al atacar a otro señor, según su poder frente al tuyo (ej. con 100): ≥ 200 →
  ×2; 81–199 → ×1; 65–80 → ×0,5; ≤ 64 → no se lo puede atacar.
- 2 ranuras nuevas: amuleto (+ % de oro por bajas, atacando y defendiendo) y cofre (% del oro
  invertido en una ciudad que se recupera al perderla, hasta 50 % con legendario).

Mías (avisadas): neutrales sin límite y exp ×1; defender da exp normal; cofre 10/20/35/50 % por
rareza; amuleto con la tabla de rarezas de siempre (+3/6/10/15 %); el oro invertido se cuenta por
dueño (al perder la ciudad vuelve a 0).

Hecho: `power.ts` (`lordPower`, `xpMultiplier`), regla R17 `TOO_WEAK`, `Town.invested`, ranuras
AMULET y CHEST, reintegro al capturar, bots que no atacan a los demasiado débiles, poder en la vista
(propio y de cada señor), ficha con «Poder de X · exp ×N» o «Demasiado débil», `STATE_VERSION` 5.
Verificado: 224 tests, 24 de Playwright (más la captura nueva de poder), revisión visual. Sim: demo
7/8; en línea 4/8 (nivel 100 en 1,5 días, 5,2 pueblos por señor, ganador 0,36): sin reajustar.

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
- Sin verificar: rendimiento en un celular real (probar con `pnpm serve` desde el celular).

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

1. Decidir si se reajusta el mundo en línea tras la regla de poder y las tropas por nivel (nivel 100
   en ~1 día, 5,5 pueblos por señor a mitad de temporada, ganador 0,35 del Dominio).

Hecho por Franco (2026-11-02): probó el 3D en el celular, abrió el puerto 8787 y subió el repo a
GitHub (`Franco944796/juego_estrategia`, licencia PolyForm Noncommercial 1.0.0).

## Comandos

- `pnpm install` · `pnpm check` (lint + typecheck + tests) · `pnpm coverage`
- `pnpm sim --bots 8 --seed 1 --runs 5 [--write]`
- `pnpm build` → `apps/client/dist/index.html` · `pnpm e2e` · `pnpm dev`
- `pnpm serve` → mundo en línea en `http://localhost:8787` (datos en
  `apps/server/data/shattered-isles.db`; borrarlo reinicia el mundo)

## Problemas conocidos

- Balance (detalle en `docs/BALANCE.md`): tensión PvP baja (demo 0,17, en línea 0,06; objetivo
  0,2–0,4); con 90 % de recuperación las ciudades cambian de dueño muchísimo; señores y ciudades
  llegan a nivel 100 bastante antes del fin de temporada.
- Tropas por encima de ~9·10¹⁵ pierden unidades por precisión de los números (determinista igual).

## Notas del motor (no obvias en el código)

- El estado solo cambia en comandos y eventos programados; `advanceTo` no acumula hasta `now`.
  Las vistas y validaciones usan proyecciones con la misma aritmética, así un replay da el mismo
  hash.
- La misión de una marcha se decide al llegar: si el pueblo es propio, refuerza; si no, ataca.
- El factor de viento queda fijo al salir la marcha.
