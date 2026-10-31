# Architecture

## Layout

```text
packages/config   GameConfig zod schema, defaults (demo preset), constants, withOverrides()
packages/engine   pure rules: map generation, wind, economy, combat, marches, commands, bots, views
apps/client       React + Vite web client; engine and bots run in a Web Worker
tools/sim         headless balance simulator, writes docs/BALANCE.md
demo/             single-file build of the client (shattered-isles.html), works offline
```

The engine depends only on `@si/config/constants` at runtime (types come from `@si/config`, which
holds zod). The client and the simulator call the engine; they never re-implement a rule.

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

## Not built yet

A multiplayer server (REST + WebSocket, shard actors, persistence with replay) would wrap the same
engine: one actor per season applying commands serially, logging accepted commands, and pushing
`view()` projections. A `RemoteGameClient` would implement `GameClient` over that protocol.
