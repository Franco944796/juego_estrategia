# Architecture

## Layout

```text
packages/config   GameConfig zod schema, defaults (demo preset), liveConfig, constants, withOverrides()
packages/engine   pure rules: map generation, wind, economy, combat, marches, commands, bots, views
packages/protocol REST and WebSocket message types shared by server and client
apps/client       React + Vite web client; engine and bots in a Web Worker, or the online world
apps/server       Fastify + WebSocket server for the online world, node:sqlite storage
tools/sim         headless balance simulator, writes docs/BALANCE.md
demo/             single-file build of the client (shattered-isles.html), works offline
```

The engine depends only on `@si/config/constants` at runtime (types come from `@si/config`, which
holds zod). The client, the server and the simulator call the engine; they never re-implement a rule.

## Engine API

```ts
createGame({ seed, config, startsAt, lords }): GameState
advanceTo(state, now): DomainEvent[]                 // runs scheduled events due by `now`
execute(state, lordId, command: unknown, now): ExecResult   // advanceTo, validate (R01–R14), apply
view(state, lordId, now): LordView                   // what one lord may see, projected to `now`
previewSend(state, lordId, from, to, troops, now): SendPreview
computeStandings(state, now): Standing[]
hashState(state): string
```

`GameState` is a plain JSON-serializable object. It changes only inside `execute` and `advanceTo`.

## Time and determinism

- The engine never reads a clock and never calls `Math.random`. Callers pass `now` (game
  milliseconds); randomness comes from a xoshiro128** generator whose state lives in `GameState.rng`.
- Scheduled events (march arrivals, wind shifts, Throne unseal, season end, bot turns) sit in a
  min-heap ordered by `(dueAt, seq)`. Two arrivals in the same millisecond resolve one after the
  other, in scheduling order.
- **Production is settled only at commands and scheduled events** (`accrueTo`). `advanceTo` does not
  settle up to `now`, so calling it more or less often never changes the result. Views and command
  validation use projections that repeat the settlement arithmetic in the same order, so a gold check
  that passes on the projection still holds after settling.
- Rejected commands never mutate the state. A log of accepted `(lordId, command, now)` entries replays
  to the same `hashState` (property-tested with fast-check).
- Wind factors use only `+ − × ÷ √`, which are correctly rounded in IEEE 754, so they match across JS
  engines. Combat losses use `**`, which is consistent within one engine; the client never resolves
  outcomes, so this matters only if a server and a replayer ran on different engines.

## Bots

Bots are lords with a personality. Their turns are scheduled events, so a whole season (including
bots) is a pure function of the seed and the human commands. A bot reads only what its vision allows
(unseen garrisons are estimated) and acts through the same validated commands as a player.

## Client

- `GameClient` is the interface the UI uses. `LocalGameClient` runs the engine in a Web Worker
  (inlined into the single HTML file) with an accelerated clock, advancing game time by real time ×
  `timeScale` × speed. The worker posts a `LordView` four times a second and after every event batch
  or command.
- The main thread renders the latest view on a Canvas 2D map at 60 fps, interpolating march positions
  from `departAt`/`arriveAt` and extrapolating game time from the last clock message.
- State: Zustand store (`src/store.ts`); text: typed es/en dictionary (`src/i18n.ts`), defaulting to
  the browser language.
- Saving: the worker posts the full state every 5 s and when the page hides; the main thread keeps it
  in `localStorage` (inside try/catch). The game pauses while the tab is hidden.

## Server (online world)

- `apps/server` is a Fastify app. `WorldService` owns the one `GameState` of the running season and
  applies every change through the engine (`joinLord`, `execute`, `setStyle`) at a logged time.
- Storage (`node:sqlite`, `apps/server/data/shattered-isles.db`): `accounts`, `seasons`,
  `season_log` (every accepted join, command and style change with its time) and `snapshots` (the
  whole state every 5 minutes and at season close). On start the server loads the last snapshot and
  replays the log after it; determinism makes the rebuilt state identical (tested, including a
  restart in the middle of a march).
- A timer wakes the world at the next scheduled engine event (at most once a second). When the season
  ends, `rollover` pays Legacy by rank band (`rewards.ts`), archives the standings, opens the next
  season at the old end time and creates a fresh map; players rejoin when they connect.
- Accounts are guests: `POST /api/session` returns a random token (stored as a SHA-256 hash) that the
  browser keeps and that doubles as the recovery code.
- REST: `/api/health`, `/api/session`, `/api/me`, `/api/join`, `/api/styles/unlock`,
  `/api/styles/equip`, `/api/hall`. WebSocket `/ws?token=…`: the client sends `command` and `preview`
  messages; the server pushes `view` (after events and every 2 s), filtered `events` and `season`
  news. Message types live in `packages/protocol`; inputs are validated with zod and limited to 20
  messages per second per socket.
- `TIME_SCALE` (environment) speeds up the server clock for the end-to-end tests only.

## Not built yet

Several leagues and shards, clans, chat, and a store. One world per server process: scaling out would
put one world actor per process and route sockets to it.
