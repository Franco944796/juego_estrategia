# Shattered Isles

An original real-time conquest game for phones and desktop browsers, drawn in detailed low poly 3D with
shadows and animated flags, smoke and soldiers (with a 2D map as an option). Floating isles, a wind that
shifts every half hour of game time and speeds up or slows down every flight between isles, towns
that grow from level 1 to 100 behind their walls, a skill point per lord level, isles of 100 towns
split into zones with a beacon each, and a world that grows a new isle whenever the newest one fills
up.

- Game design: [docs/DESIGN.md](docs/DESIGN.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Balance report and tuning log: [docs/BALANCE.md](docs/BALANCE.md)

## Play

`pnpm serve` builds the client and starts the online world at `http://localhost:8787`. The title
screen also offers a single-player season against bots, with accelerated time (a season lasts about
18 real minutes at ×1).

### Test accounts

List recovery codes (from the profile, one per line, `#` starts a comment) in
`apps/server/data/dev-accounts.txt`; the server re-reads it when it changes. A test account upgrades
towns for free, buys Legacy items and styles for free, gets test tools (troops in the town sheet,
levels in the menu) and stays out of the ranking, Legacy rewards, medals and league moves.

## Online world

One public world for everyone, in real time; each season lasts 30 days and closes with Legacy rewards
by final rank (see [docs/DESIGN.md](docs/DESIGN.md), section 11).

```sh
pnpm serve            # builds the client and starts the game server on port 8787
```

Open `http://localhost:8787`, or `http://<this computer's IP>:8787` from another device on the same
network. The world is stored in `apps/server/data/shattered-isles.db`; delete that file to start over.
If a firewall blocks the port, open TCP 8787 (with firewalld: `sudo firewall-cmd --add-port=8787/tcp`).

## Develop

Requirements: Node.js 20 or newer and pnpm.

```sh
pnpm install          # install dependencies
pnpm check            # lint, typecheck and all unit tests
pnpm dev              # client with hot reload at http://localhost:5173
```

Other commands:

| Command                  | What it does                                                      |
| ------------------------ | ----------------------------------------------------------------- |
| `pnpm coverage`          | Unit tests with engine coverage (fails under 90% of lines)        |
| `pnpm build`             | Builds the single-file client into `apps/client/dist/index.html`  |
| `pnpm e2e`               | Playwright tests on the built client (390×844 and 1280×800)       |
| `pnpm sim`               | Simulates demo seasons played by bots and prints the pacing table |
| `pnpm sim --preset live` | Same for the 30-day online world                                  |
| `pnpm sim --write`       | Also rewrites that preset's section of `docs/BALANCE.md`          |
| `pnpm format`            | Formats everything with Prettier                                  |
| `pnpm serve`             | Builds the client and starts the online server (port 8787)        |

Playwright needs its browser once: `pnpm --filter @si/client exec playwright install chromium`.

## Layout

```text
packages/config   game configuration: zod schema and defaults
packages/engine   deterministic rules engine and bots
apps/client       React web client (engine in a Web Worker, or the online world)
apps/server       Fastify server for the online world (node:sqlite)
packages/protocol messages shared by the server and the client
tools/sim         balance simulator
docs/             design, architecture, balance
```

## Status

Built: the rules engine with bots, the balance simulator, the offline single-player demo and the online
world (server with persistence and replay, guest accounts with a recovery code, monthly seasons,
Legacy rewards and town styles, clans with allied reinforcements, chat). Not built yet: several leagues
and any store.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free to read, study and use for noncommercial purposes.
Any commercial use needs written permission from the copyright holder (Franco944796).
