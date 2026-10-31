# Shattered Isles

An original real-time conquest game for phones and desktop browsers. Floating isles, a wind that
shifts every half hour of game time and speeds up or slows down every flight between isles, three
troop types that counter each other, beacons for whole isles and a Sky Throne worth fighting over.

- Game design: [docs/DESIGN.md](docs/DESIGN.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Balance report and tuning log: [docs/BALANCE.md](docs/BALANCE.md)

## Play the demo

Open `demo/shattered-isles.html` in a browser. It works offline: one human lord against bots, with
accelerated time (a season lasts about 18 real minutes at ×1).

## Develop

Requirements: Node.js 20 or newer and pnpm.

```sh
pnpm install          # install dependencies
pnpm check            # lint, typecheck and all unit tests
pnpm dev              # client with hot reload at http://localhost:5173
```

Other commands:

| Command                      | What it does                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| `pnpm coverage`              | Unit tests with engine coverage (fails under 90% of lines)      |
| `pnpm build:demo`            | Builds the single-file demo into `demo/shattered-isles.html`    |
| `pnpm e2e`                   | Playwright smoke tests on the built demo (390×844 and 1280×800) |
| `pnpm sim --bots 8 --runs 5` | Simulates seasons played by bots and prints the pacing table    |
| `pnpm sim --write`           | Same, and rewrites `docs/BALANCE.md` (keeping its tuning log)   |
| `pnpm format`                | Formats everything with Prettier                                |

Playwright needs its browser once: `pnpm --filter @si/client exec playwright install chromium`.

## Layout

```text
packages/config   game configuration: zod schema and defaults
packages/engine   deterministic rules engine and bots
apps/client       React web client (engine in a Web Worker)
tools/sim         balance simulator
docs/             design, architecture, balance
```

## Status

Built: the rules engine with bots, the balance simulator and the offline single-player demo. Not
built yet: the multiplayer server, accounts, clans, chat and any store.
