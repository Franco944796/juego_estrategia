# Shattered Isles — Game Design

Original real-time conquest game for phones and desktop browsers. The sky-realm shattered into floating
isles; each season lords race to light the beacons of their zones. Lore never affects mechanics.

All numbers below are defaults from `packages/config` (the config is authoritative; balance changes are
logged in `docs/BALANCE.md`). Config keys are written as `section.key`.

## 1. Pillars

1. **Timing over micromanagement.** The wind decides when a raid is fast or slow; reading the forecast
   is the core skill.
2. **Exponential growth.** Towns climb from level 1 to 100 and their output, walls and costs grow
   from tens to trillions; numbers read as K, M, G, T.
3. **Hold ground, score over time.** Dominion accrues every minute from what you hold, so late grabs
   cannot steal a season held well.
4. **One finger, short sessions.** Every action is tap, tap, confirm.
5. **Deterministic rules.** Same seed and same commands give the same season, bit for bit.

## 2. World

- A season starts with **one big isle** of `map.isle.towns` (100) neutral towns laid on a spiral, higher
  levels toward the middle (`map.isle.tierBands`, `map.isle.tiers`: level 3 inside, then 2, then 1).
- Each isle is split into **zones** of about `map.isle.zoneSize` (10) towns: one in the middle, then
  rings of 3, 6, 9… sectors. Every zone has its own beacon (§7).
- Each isle holds `map.spawn.slots` (10) lords. A new lord's capital is a **random neutral town of the
  isle**: anywhere for the first lord, then among the `map.spawn.farShare` (25%) of neutral towns
  farthest from the existing capitals. It becomes a capital of `lords.capitalTier` with the starting
  troops, and its `map.spawn.privateTowns` (3) nearest neutral neighbors become level-1 towns that only
  that lord sees and may attack until someone owns them. Capitals and private towns leave their zones.
  Only when an isle has no neutral town left does the capital go on a shore slot, as it used to.
  Lords go to the newest isle with room.
- **Growth is off for now** (`map.growth.enabled: false`, demo and online): every season keeps its
  first isle while the 3D map is tried out, and joining fails with `WORLD_FULL` once its 10 slots are
  taken. With growth on, the rules below apply.
- **A new isle is born** when the newest isle is full (every slot taken) or fully conquered (every
  public town owned), at most `map.growth.maxPerDay` (3) per 24 game hours, not counting the first. New
  isles go in rings of 6, 12, 18… around the first, `map.growth.isleSpacing` apart.
- **Sky lanes** link each new isle to its `map.growth.laneNeighbors` nearest isles within
  `map.growth.maxLaneLength` (always at least one, so the map stays connected). Lanes are never removed.
- A march may target any town on **the same isle** or on an isle **joined by a lane** to the origin's
  isle.

## 3. Wind

- The wind blows toward one of 8 compass directions. It shifts every `wind.shiftEveryMin` (30) game
  minutes by ±45° or ±90°, following a schedule rolled from the season seed. Players see the current
  direction, a countdown, and the next `wind.forecastShifts` (2) directions.
- Between isles, march speed is multiplied by a **wind factor**. With `c` = cosine of the angle between
  the travel direction and the wind:
  - `c ≥ 0`: `factor = 1 + (wind.tailwindMax − 1) · c` → tailwind ×2;
  - `c < 0`: `factor = 1 + (1 − wind.headwindMin) · c` → headwind ×0.5; crosswind ×1.
- Inside an isle the wind does not apply. With a single isle at the start of a season, the wind only
  matters once the second isle is born.
- The factor is **locked when the march departs**; later shifts do not change its arrival time.

## 4. Troops

There is a **single troop type**. A troop is worth 1 in attack and 1 in defense; marches move at
`march.landSpeed` inside an isle and `march.skySpeed` between isles.

## 5. Towns

- Fields: owner (lord or neutral), **level 1–100** (`towns.maxTier`, called `tier` in the code),
  garrison, capital flag.
- **Level scale.** Everything that grows with the level is multiplied by `scale(L)`: 1 at level 1,
  `towns.scale.second` (2.5) at level 2 and `towns.scale.top` (5·10¹¹) at level 100. Its logarithm grows
  as `(L − 1)^p` with `p < 1`, so early levels jump most (×2.5, ×1.8, ×1.7…) and late ones about ×1.2.
- **Production per game minute** (owned towns), **with no cap**: troops pile up forever.
  - gold → owner's treasury: `towns.goldPerMin (2) × scale(L)`;
  - troops → garrison: `towns.troopsPerMin (1.2) × scale(L)`;
  - multipliers: capital ×`towns.capitalProdMult` (1.5), lit beacon +`beacon.prodBonus` (25%), skills.
- **Walls**: every town has `towns.walls (20) × scale(L)` points of defense of its own, rounded to two
  significant digits: 20 at level 1, 50 at level 2, 92 at 3… 10T at level 100. Walls never fall.
- **Upgrade**: instant, costs `towns.upgradeCost (8) × scale(L)` gold from level L. One order may buy
  several levels in a row (as many as asked and paid for).
- **Fortification** multiplies the defending troops: `1 + towns.fortPerTier (0.05) · (L − 1)` (+5% per
  level, ×1 at level 1), ×`towns.capitalFort` for capitals, ×`throne.fortMult` for the Throne.
- **Neutral towns** are levels 1–3 (§2). They start with `neutral.garrison[L]` troops and regenerate at
  ×`neutral.regenMult` of the normal rate up to that initial size.

## 6. Marches and combat

- **Send**: choose source town, target town and how many troops. The mission is decided on arrival: own
  town → reinforce; any other town → battle.
- **Grouped send** (`SEND_GROUP`): pick several own towns; each sends **all** its troops. They all
  leave at once and arrive together with the slowest one (the closer ones just travel slower), then
  fight as one army or reinforce as one. The send screen preselects the 5 nearest towns with troops.
- **Travel time** = distance ÷ (`march.landSpeed` or `march.skySpeed` × wind factor × boots) ×
  `1 + march.perDigit (5) × (digits of the troop count − 1)`: up to 9 troops cross an isle (~540) in
  about 10 real seconds, 100 troops take ×11, a million ×31, a trillion ×61. Speeds are set so a
  march lasts the same real seconds in the demo (×20 game time) and online. No march takes less than
  `march.minDurationMin` (0.6 real seconds).
- **Power.**
  - `P_att = troops × (1 + attack skill bonus)`
  - `P_def = garrison × fortification + walls` (plus allied contingents × fortification)
- **Outcome.** The higher power wins; a **tie goes to the defender**. The loser loses every troop (walls
  stay). The winner loses the fraction `(P_loser / P_winner) ^ combat.lossExponent` (1.5), survivors
  floored. With 0 troops and 0 attack points a level-1 town needs 21 attackers.
- **Recovery (league rule).** `league.attackerRecovery` (90%) of the attacker's dead and
  `league.defenderRecovery` (90%) of each defending lord's dead reappear at once in that lord's capital
  (its highest-level town without one; lost with no town). There are no wounded troops. Neutral
  garrisons recover nothing.
- **Kill rewards.** Each enemy troop killed gives `kills.xp.attack` (5) experience and `kills.gold.attack`
  (5) gold to the attacker, and `kills.xp.defend` (3) / `kills.gold.defend` (3) to the defenders (shared
  by the power each contingent brought, walls counting for the owner). Neutral troops count too.
- **Capture.** If the attacker wins with at least one survivor, the town changes owner and the
  survivors become its garrison; the level is kept. The attacker gains plunder
  (`plunder.base (40) × scale(L)`). If no attacker survives, the garrison is still destroyed but the town
  keeps its owner.
- Two separate marches that reach the same town resolve as separate battles, in arrival order.
- Losing a capital moves it to the owner's highest-level town (lowest id on ties).

## 7. Beacons, Throne and Dominion

- **Beacon.** A lord who owns every town of a zone lights its beacon: +25% production in that zone, +`beacon.dominionPerMin` Dominion and `beacon.visionHops` more lanes of vision from that isle. Losing
  any town of the zone puts it out. Capitals and private towns belong to no zone.
- **Sky Throne** (off by default, `throne.enabled`). When on, the middle town of the first isle is the
  Throne: sealed until `throne.unsealAtFraction` (30%) of the season, then its holder earns
  `throne.dominionPerMin` (25) Dominion per minute on top of the town's own.
- **Dominion** accrues every game minute: `dominion.perTier` (1) × level per owned town, plus lit
  beacons, plus the Throne if any. The season ranking sorts by Dominion, then lord level, then lord id.

## 8. Lord levels and skills

- Experience comes from kills (§6). Level n → n+1 needs `round(levels.xpBase (50) × scale(n))`, so lord
  levels keep pace with town levels; up to `levels.maxLevel` (100). Levels reset with the season.
- Each level reached gives **one skill point**. Points are spent one at a time and stay put until the
  season ends (no reassigning).

| Skill  | Per point (`skills.perPoint`) |
| ------ | ----------------------------- |
| Gold   | +5% gold production           |
| Troops | +5% troop production          |
| Attack | +5% attack power              |

Bonuses add up (10 points in Gold = +50%). The **Attacker** and **Defender** skills are the recovery
shares of §6: league 1 fixes both at the 90% maximum, so they take no points. Other leagues may lower
them and let points raise them.

## 8b. Equipment

- Six slots, each improving one thing by the item's rarity bonus (`gear.rarityBonus`: common 3%, rare
  6%, epic 10%, legendary 15%), added to the skill bonus of the same kind:

| Slot   | Improves                               |
| ------ | -------------------------------------- |
| Weapon | attack                                 |
| Armor  | defense of the lord's troops (× fort.) |
| Helmet | walls of the lord's towns              |
| Cloak  | troop production                       |
| Boots  | march speed                            |
| Ring   | gold production                        |

- A lord finds one item every `gear.dropEveryLevels` (5) levels: any slot, rarity rolled with the
  weights of the last `gear.dropOdds` row its level reached (better at high levels).
- Online, items are also bought with Legacy (`gear.prices`: 20 / 50 / 120 / 300).
- **Items are permanent**: they belong to the account and every season starts with the account's
  items and gear. This is the one thing Legacy buys that changes play (styles stay cosmetic).
- Equipping (`EQUIP`) is instant and allowed at any time; one item per slot.

## 9. Vision

- Everyone sees the political map: owners, levels, walls, beacons and the wind.
- Garrison sizes are visible on isles where the lord or a clanmate owns a town and on isles one lane
  away (two from an isle with a lit friendly beacon).
- Another lord's private towns are hidden altogether (and so are marches toward them).
- **Every march is public** and shown live: everyone sees who marches from where to where. The owner
  sees the exact size; the lord whose town is the target sees only its band of one digit (10–100,
  100–1K, 1K–10K…, a whole group's total); nobody else sees a size. Server events for another lord's
  march carry 0 troops.

## 10. Exile and season end

- A lord with no towns and no marches in flight is **exiled**: it restarts on a free neutral town (the
  newest isle that still has a public one, lowest level) with `exile.troops`, keeping gold, Dominion,
  level and skills. With no neutral town left it is eliminated.
- At the season end every command is rejected and the final ranking is frozen.

## 11. Online world

The online world uses `liveConfig` (`packages/config/src/presets.ts`): the same rules, in real time.

- **One public world, one league.** A season lasts 30 days. At the end the ranking is frozen, rewards
  are paid and a new season starts with a fresh map. Players join whenever they connect and appear on
  a shore slot with a level-1 capital and their private towns (§2). When every isle is full and today's
  isles are spent, joining fails with `WORLD_FULL` until the next isle is born.
- **Capitals cannot be attacked** (`rules.capitalImmune`, on in the demo too; a shield marks them on
  the map). A march whose target became a capital on the way (an exiled lord restarting there)
  returns home (`MARCH_REPELLED`).
- **Snowball brakes:** your towns within `towns.homeRadius` (110) of your capital get
  ×`towns.homeFort` (3) fortification, and owning more than `towns.sprawl.freeTowns` (6) towns divides the production of all
  your towns by `1 + towns.sprawl.penaltyPerTown (0.1) × extra towns`. The demo uses the same brakes,
  milder: ×1.5, and −5% per town beyond 8.
- **Economy:** the demo's production per minute, upgrade costs ×40, plunder ×5 and 400 starting gold,
  so an active player's best town reaches level 100 in about two to three days; the wind shifts every
  3 hours.
- **Rewards by final rank:** top 5% → 100 Legacy, top 25% → 50, top 50% → 25, everyone else who
  played → 10 (`rewards.tiers`; each cut-off rounds up and holds at least one player). Legacy is
  permanent and only buys town styles (`cosmetics.styles`); it never changes the rules of a season.
- No bots in the online world.
- **Clans.** Anyone may found a clan (name and a 2–4 letter tag). Others ask to join; the leader or
  an officer accepts. At most 20 members; clans last across seasons. A leaving leader hands over to
  the oldest officer (else the oldest member); the last member out closes the clan.
- **Allies** (same clan) never fight: a march to an ally's town **stations** its troops there. The town
  is then defended by the owner's garrison plus every allied contingent; all contingents lose the
  same fraction, kill rewards are shared by the power each brought, and each lord recovers its own
  dead in its own capital. A lord may move its stationed troops out again. Allies share vision. When an alliance
  breaks, stationed contingents march back to their capitals.
- **Chat:** a global channel and one per clan; lines up to 200 characters; the last 100 are kept.
- **Clan ranking:** summed Dominion of the members; the top clan of each season gets a medal shown in
  the hall of fame (no extra Legacy).

## 12. Rule register

Every command is validated by the engine; each rule has a passing and a violating test.

| Id  | Rule                                                                           |
| --- | ------------------------------------------------------------------------------ |
| R01 | The acting lord exists and is not eliminated.                                  |
| R02 | The season has started and has not ended.                                      |
| R03 | The town acted on (upgrade, send from) belongs to the acting lord.             |
| R04 | Upgrade only below the maximum level.                                          |
| R05 | The lord has enough gold for at least one level.                               |
| R06 | Retired (it was respecialization).                                             |
| R07 | The troop count is an integer of at least `march.minTroops`.                   |
| R08 | Troops sent do not exceed the garrison.                                        |
| R09 | Target differs from source.                                                    |
| R10 | Target is on the same isle or on an isle joined by a lane.                     |
| R11 | The Throne (when enabled) cannot be targeted while sealed.                     |
| R12 | Attacks in flight (a group counts once) stay below `march.maxActivePerLord`.   |
| R13 | A skill point can be spent only if the lord has one left.                      |
| R14 | Command payloads have the right shape; another lord's private town is unknown. |
| R15 | With `rules.capitalImmune`, another lord's capital cannot be targeted.         |
| R16 | A lord equips only items it owns.                                              |

## 13. Bots

Each bot thinks every `bots.thinkEveryMin` game minutes (with seeded jitter) through the same command
API as players, and reads only what its vision allows (unseen garrisons are guessed as
`bots.guessMin` (60) minutes of the town's production). It
weighs only the `bots.targetsPerTown` (12) nearest targets of each town, plus a few on each linked
isle, from its strongest towns.

| Personality | Behavior                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| Raider      | Attacks at low margins, favors tailwinds, puts points into Attack.            |
| Builder     | Upgrades first, attacks only with a wide margin, completes zones for beacons. |
| Warden      | Reinforces threatened towns, conquers neutrals, rarely attacks lords.         |
| Climber     | Builds up and goes for the Throne (when enabled) once it is unsealed.         |

Turn order: spend skill points (`skillWeights` per personality) and wear the best items → reinforce threatened towns → spend
gold on upgrades (the best town takes every level the gold pays for) → launch the best attack (value ÷
travel time, predicted power ratio above the personality margin) → move the troops of towns holding
more than `bots.hoardMin` (30) minutes of production to the most exposed of their nearest own towns.

## 14. Demo (single player)

- One human lord against `demo.bots` bots on a seeded map, accelerated time (`demo.timeScale` 20),
  season of `season.durationMin` (360) game minutes ≈ 18 real minutes. Pause and ×2 / ×4 speeds.
- Runs offline from one HTML file; the engine and bots run in a Web Worker; progress is saved locally,
  and so is the player's equipment, which carries over to the next demo game.
- Screen: the map with the HUD on top (gold, Dominion, and the portrait with the lord level, which
  opens the profile: Gear, Skills, Stats) and a column of picture buttons on the right (marches,
  reports, ranking, social online, menu).
- **3D map** (default; the menu switches to the lighter 2D map, also used when WebGL is missing):
  low poly floating isles with trees and clouds, seen from a tilted tabletop camera (drag to move,
  pinch or wheel to zoom, no rotation). Towns are built in code by stage, roofs and flags in the
  owner's color: hut (levels 1–9), fenced house (10–29), village with a watchtower (30–59), palisade
  fort (60–89), stone citadel (90–99) and a full castle at level 100. Marches are a few soldiers
  behind a banner in the owner's color (red when they come for you). Levels, garrisons and march
  sizes are drawn as labels over the scene.
- Onboarding: tap your capital → send troops to a neutral town on your isle → watch the wind → upgrade a
  town. First conquest in under 60 real seconds.
- Acceptance (15 real minutes): finish onboarding, hold 6+ towns, light a beacon, spend a skill point, see a
  bot attack resolve, open the ranking.
