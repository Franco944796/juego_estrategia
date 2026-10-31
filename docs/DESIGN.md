# Shattered Isles — Game Design

Original real-time conquest game for phones and desktop browsers. The sky-realm shattered into floating
isles; each season the Sky Throne stands empty and lords race to claim it. Lore never affects mechanics.

All numbers below are defaults from `packages/config` (the config is authoritative; balance changes are
logged in `docs/BALANCE.md`). Config keys are written as `section.key`.

## 1. Pillars

1. **Timing over micromanagement.** The wind decides when a raid is fast or slow; reading the forecast
   is the core skill.
2. **Composition matters.** Three troop types counter each other, so the size of an army is not enough.
3. **Hold ground, score over time.** Dominion accrues every minute from what you hold, so late grabs
   cannot steal a season held well.
4. **One finger, short sessions.** Every action is tap, tap, confirm.
5. **Deterministic rules.** Same seed and same commands give the same season, bit for bit.

## 2. World

- **Isles** sit on concentric rings around the central **Throne isle** (`map.rings`). Each isle has 3–5
  **towns** (`map.townsPerIsle`). The Throne isle holds a single town, the Throne.
- **Sky lanes** link isles: every isle connects to its `map.laneNeighbors` nearest isles within
  `map.maxLaneLength`, inner-ring isles connect to the Throne isle, and a spanning tree guarantees that
  the graph is connected.
- A march may target any town on **the same isle** or on an isle **joined by a lane** to the origin's
  isle.
- Lords start on the outer ring, each with a tier-2 capital on its own isle. The other towns start
  neutral; their tier grows toward the center (`map.rings[].tiers`).

## 3. Wind

- The wind blows toward one of 8 compass directions. It shifts every `wind.shiftEveryMin` (30) game
  minutes by ±45° or ±90°, following a schedule rolled from the season seed. Players see the current
  direction, a countdown, and the next `wind.forecastShifts` (2) directions.
- Between isles, march speed is multiplied by a **wind factor**. With `c` = cosine of the angle between
  the travel direction and the wind:
  - `c ≥ 0`: `factor = 1 + (wind.tailwindMax − 1) · c` → tailwind ×2;
  - `c < 0`: `factor = 1 + (1 − wind.headwindMin) · c` → headwind ×0.5; crosswind ×1.
- Inside an isle the wind does not apply.
- The factor is **locked when the march departs**; later shifts do not change its arrival time.

## 4. Troops

| Type           | Code      | Attack | Defense | Speed | Production |
| -------------- | --------- | ------ | ------- | ----- | ---------- |
| Lancers        | `LANCER`  | 1.0    | 1.2     | 1.0   | ×1.0       |
| Archers        | `ARCHER`  | 1.1    | 1.0     | 1.0   | ×0.9       |
| Griffin riders | `GRIFFIN` | 1.2    | 0.8     | 1.3   | ×0.7       |

Counter triangle: **Lancers beat Griffins, Griffins beat Archers, Archers beat Lancers.** A unit fighting
a type it beats is worth ×`combat.counterBonus` (1.5); against the type that beats it, ÷1.5.

A march moves at the speed of its slowest type.

## 5. Towns

- Fields: owner (lord or neutral), tier 1–5, **specialization** (the troop type it trains), garrison
  per type, capital flag.
- **Production per game minute** (owned towns):
  - gold → owner's treasury: `towns.goldPerMin[tier]`;
  - troops of its specialization → garrison: `towns.troopsPerMin[tier] × type production`;
  - multipliers: capital ×`towns.capitalProdMult` (1.5), lit beacon +`beacon.prodBonus` (25%), edicts.
  - Troop production pauses while the garrison is at or above `towns.garrisonCap[tier]`. Troops sent
    in as reinforcements may exceed the cap.
- **Upgrade**: instant, costs `towns.upgradeCost[tier]` gold. Raises production, cap, fortification and
  Dominion.
- **Respecialize**: instant, costs `towns.respecCostPerTier × tier`; the garrison is unchanged.
- **Fortification** multiplies defending power: `1 + towns.fortPerTier · (tier − 1)` (+25% per tier),
  ×`towns.capitalFort` for capitals, ×`throne.fortMult` for the Throne, edicts.
- **Neutral towns** start with a mixed garrison (`neutral.garrison[tier]`, 60% of their specialization,
  20% of each other type) and regenerate their specialization at ×`neutral.regenMult` of the normal rate
  up to that initial size.

## 6. Marches and combat

- **Send**: choose source town, target town and how many troops of each type. The mission is decided on
  arrival: own town → reinforce; any other town → battle.
- **Travel time** = distance ÷ (`march.landSpeed` or `march.skySpeed` × wind factor) × slowest type
  speed and edicts. No march takes less than `march.minDurationMin`.
- **Power.** For army X against army Y, each unit's multiplier is the average of the counter matrix over
  Y's composition: `mult_i = Σ_j share_Y(j) · M[i][j]` (1 if Y is empty).
  - `P_att = Σ_i a_i · atk_i · mult_i(vs D)`
  - `P_def = Σ_j d_j · def_j · mult_j(vs A) · fortification`
- **Outcome.** The higher power wins; a **tie goes to the defender**. The loser loses every unit. The
  winner loses the fraction `(P_loser / P_winner) ^ combat.lossExponent` (1.5) of each type, rounded
  so survivors are floored. An empty town has `P_def = 0` and falls without losses.
- **Capture.** If the attacker wins with at least one survivor, the town changes owner and the
  survivors become its garrison; the tier is kept. The attacker gains plunder
  (`plunder.goldByTier[tier]`) and glory. If no attacker survives, the garrison is still destroyed but
  the town keeps its owner.
- Two marches that reach the same town resolve as separate battles, in arrival order.
- Losing a capital moves it to the owner's highest-tier town (lowest id on ties).

## 7. Beacons, Throne and Dominion

- **Beacon.** A lord who owns every town of an isle lights its beacon: +25% production on that isle, +`beacon.dominionPerMin` Dominion and wider vision. Losing any town of the isle puts it out.
- **Sky Throne.** Sealed until `throne.unsealAtFraction` (30%) of the season; until then it cannot be
  targeted. Its holder earns `throne.dominionPerMin` (25) Dominion per minute on top of the town's own.
- **Dominion** accrues every game minute: `dominion.perTier[tier]` per owned town, plus lit beacons,
  plus the Throne, times edicts. The season ranking sorts by Dominion, then glory, then lord id.

## 8. Glory and edicts

- **Glory**: +1 per `glory.troopsPerPoint` (10) enemy troops killed, attacking or defending, and +`glory.perCaptureTier` × tier per capture.
- Each threshold in `edicts.gloryThresholds` opens a **draft**: 3 random edicts not yet taken; the lord
  keeps one for the rest of the season. Drafts wait until a choice is made.

| Edict        | Effect                             |
| ------------ | ---------------------------------- |
| Swift Wings  | Griffin speed ×1.2                 |
| Spear Wall   | Lancer defense ×1.25               |
| Arrow Storm  | Archer attack ×1.25                |
| Golden Tide  | Gold production ×1.2               |
| Muster       | Troop production ×1.15             |
| Architects   | Upgrade cost ×0.8                  |
| Wind Readers | Headwind floor 0.75 instead of 0.5 |
| Bulwarks     | Fortification ×1.1                 |
| Plunderers   | Plunder ×2                         |
| Legend       | Dominion ×1.15                     |
| Veterans     | Winner losses ×0.8                 |

## 9. Vision

- Everyone sees the political map: owners, tiers, specializations, beacons and the wind.
- Garrison sizes are visible on isles where the lord owns a town and on isles one lane away (two with a
  lit beacon on the origin isle).
- A lord sees its own marches, every march targeting its towns, and other marches whose origin or target
  isle is visible.

## 10. Exile and season end

- A lord with no towns and no marches in flight is **exiled**: it restarts on a free neutral town (the
  outermost ring that still has one, lowest tier) with `exile.troops`, keeping gold, Dominion, glory and
  edicts. With no neutral town left it is eliminated.
- At the season end every command is rejected and the final ranking is frozen.

## 11. Rule register

Every command is validated by the engine; each rule has a passing and a violating test.

| Id  | Rule                                                                              |
| --- | --------------------------------------------------------------------------------- |
| R01 | The acting lord exists and is not eliminated.                                     |
| R02 | The season has started and has not ended.                                         |
| R03 | The town acted on (upgrade, respecialize, send from) belongs to the acting lord.  |
| R04 | Upgrade only below the maximum tier.                                              |
| R05 | The lord has enough gold for the upgrade or respecialization.                     |
| R06 | Respecialize only to a different type.                                            |
| R07 | Troop amounts are non-negative integers and add up to at least `march.minTroops`. |
| R08 | Troops sent do not exceed the garrison, per type.                                 |
| R09 | Target differs from source.                                                       |
| R10 | Target is on the same isle or on an isle joined by a lane.                        |
| R11 | The Throne cannot be targeted while sealed.                                       |
| R12 | Active marches per lord stay below `march.maxActivePerLord`.                      |
| R13 | An edict can be chosen only from the pending draft.                               |
| R14 | Command payloads have the right shape (unknown ids and types are rejected).       |

## 12. Bots

Each bot thinks every `bots.thinkEveryMin` game minutes (with seeded jitter) through the same command
API as players, and reads only what its vision allows (unseen garrisons are estimated from tier).

| Personality | Behavior                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| Raider      | Attacks at low margins, favors griffins and tailwinds, keeps little gold.     |
| Builder     | Upgrades first, attacks only with a wide margin, completes isles for beacons. |
| Warden      | Reinforces threatened towns, conquers neutrals, rarely attacks lords.         |
| Climber     | Builds up and goes for the Throne once it is unsealed.                        |

Turn order: choose a pending edict → reinforce threatened towns → spend gold on upgrades → launch the
best attack (value ÷ travel time, predicted power ratio above the personality margin) → move surplus
troops toward the frontier.

## 13. Demo (single player)

- One human lord against `demo.bots` bots on a seeded map, accelerated time (`demo.timeScale` 20),
  season of `season.durationMin` (360) game minutes ≈ 18 real minutes. Pause and ×2 / ×4 speeds.
- Runs offline from one HTML file; the engine and bots run in a Web Worker; progress is saved locally.
- Onboarding: tap your capital → send troops to a neutral town on your isle → watch the wind → upgrade a
  town. First conquest in under 60 real seconds.
- Acceptance (15 real minutes): finish onboarding, hold 6+ towns, light a beacon, choose an edict, see a
  bot attack resolve, open the ranking.
