# PRD: Heroic and Mythic+ Dungeons with Forged Drops

Status: draft v3 (anchor verification pass against release/v0.20.0 on
2026-07-03: the world-boss references below live in PR #1034, open and
not merged; every other cited anchor verified in-tree)
Owner: design
Companion docs: `docs/prd/badges.md` (heroic/mythic+ is the badge
system's primary earner) and `docs/prd/ENDGAME_PHASE1_HANDOFF.md` (the
verified P1 implementation handoff: slices, hook-point map, string
inventory, gotchas)

## 1. Summary

Two difficulty layers on top of the **existing** dungeons, reusing their
layouts, mob rosters, and mechanics wholesale, plus a forged-drop system
that gives every heroic and mythic+ loot roll a chance to come back
better than its base item:

- **Heroic:** every dungeon re-tuned to level 20. The Hollow Crypt (a
  level 7 to 10 leveling dungeon) becomes max-level endgame content again.
  One toggle, no new maps.
- **Mythic+:** an infinitely scaling ladder above heroic. Each keystone
  level multiplies enemy health and damage; affixes unlock at level
  thresholds; rewards scale with the level you clear. **Untimed**: the
  pressure is surviving, not racing a clock or a minigame.
- **Forged drops (the titanforging analogue):** heroic and mythic+ gear
  drops can roll **Valeforged** (the item comes back 2 item levels higher,
  with the budget scaled to match) or **Swiftforged** (a 3% to 5%
  movement-speed bonus, a property no base item has, never stackable).
  The same boss on the same day can still surprise you, so farmed content
  never fully dries up.

This is the highest content-per-effort move available: three finished
dungeons become an infinite ladder with chase variance, with zero new
geometry, zero new mobs, and near-zero new i18n.

Design references: classic-era heroic dungeons (same dungeon, cap-level
tuning, daily lockout, badge on the end boss), the mythic+ keystone model
(compounding scaling, affix thresholds, best-level ladder) minus the
timer, and titanforging (drop-time upgrade rolls) minus the infinite
ilvl creep: forge bonuses are small, capped, and never beat raid drops by
more than the forge margin.

## 2. Background and motivation

### 2.1 The gap
Only Gravewyrm Sanctum and the Nythraxis raid are relevant at the cap.
The Hollow Crypt and The Sunken Bastion, the two most polished instances
in the game, are outleveled and abandoned. Capped players have no
difficulty knob at all: content is either on farm or not.

### 2.2 Player direction this encodes (definitive)
- Keep 20 as the cap; difficulty and reward scale instead of levels.
- Rewards scale with challenge, not a linear level treadmill.
- No punishing minigames between the player and the loot (the delve
  lockpick complaint): mythic+ is untimed, and every reward is granted on
  the kill or the clear.
- Normal leveling dungeons pay no endgame currency; heroic is where the
  endgame loop starts (badges.md pillar 1).

## 3. Current state in the codebase (what this reuses and what must change)

Reused as-is:
- **Instancing:** `src/sim/instances/dungeons.ts` keys instance slots per
  party and handles enter/leave/reset lifecycle. Difficulty joins the key.
- **Mob definitions:** `src/sim/content/dungeons.ts` records carry levels,
  stats, and mechanics (aoePulse, cleave, stomp, mortalStrike, adds).
  Heroic is a deterministic transform of these records, not a copy.
- **Affix content model:** delve affixes
  (`src/sim/content/delves/affixes.ts`) already express "modify enemy
  stats and mechanics by tier"; mythic+ affixes are a sibling record set,
  not a delve dependency.
- **Loot plumbing:** loot tables, need/greed, rarity tiers
  (`src/sim/loot/`); per-contributor personal loot arrives with the
  PR #1034 world boss.
- **Move-speed hook:** `Sim.moveSpeedMult()` (`src/sim/sim.ts`) already
  aggregates speed modifiers (fiesta augments contribute `moveSpeedPct`,
  `buff_speed` auras exist). Swiftforged folds in here; no new movement
  code path.
- **Daily gates:** the `delveDaily` UTC-day pattern (in tree:
  `refreshDelveDaily`, `src/sim/delves/runs.ts`); `worldBossDaily` is the
  same pattern arriving with PR #1034 (open, not merged).
- **Ladder:** `src/sim/leaderboard_page.ts` is host-agnostic and
  paginated; best-keystone-level is a new sort key, not a new system.

Must change (the honest engineering cost):
- **Item instances exist in inventory but not on the paperdoll.** As of
  release/v0.20.0 (professions, #1165/#1174), `InvSlot` carries an
  optional `instance?: ItemInstancePayload` with `rolled` stat values,
  `boundTo` binding, per-copy `charges`, and `cloneInvSlot` deep-clone
  discipline at save/load boundaries; the World Market already blocks
  instanced items at list time (real handling deferred to #1146). Forge
  builds on that payload (section 5.6) instead of inventing a parallel
  one. The remaining gap: `PlayerEquipment` still maps slot to a bare
  item-id string and `recalcPlayerStats()` reads `ITEMS[itemId].stats`,
  so equipping currently drops the payload. Equipment must learn to
  carry the instance; that is the largest single work item in this PRD,
  and everything else is data and transforms.

## 4. Goals and non-goals

### Goals
1. Every existing dungeon is playable at the cap via a heroic toggle.
2. Mythic+ gives the most engaged players an uncapped difficulty ladder
   with a visible leaderboard.
3. Reward quality scales with difficulty: better tables, daily-gated
   chests with slot variety, and forge chances that rise with keystone
   level.
4. 100% reuse of existing dungeon geometry and mobs; new content records
   are scaling tables, affix definitions, and forge rules only.

### Non-goals
- No run timer, no depleting keystones, no key items in bags (v1 tracks
  the unlocked level per character).
- No new dungeons in this PRD; no mythic+ for the raid.
- No forged drops outside heroic/mythic+ in v1 (no forged world-boss,
  delve, or normal-dungeon loot; no forged badge-vendor gear).
- No open-world difficulty scaling.
- Forge bonuses never introduce a new best-in-slot over raid gear beyond
  the forge margin itself (a Valeforged heroic rare stays below a raid
  epic).

## 5. Functional requirements

### 5.1 Difficulty selection and instancing
- The party leader sets the difficulty (normal / heroic / mythic+ level N)
  before entering; the instance slot is keyed `(dungeonId, difficulty)`.
- Mythic+ level N is selectable up to `bestCleared + 1` for that dungeon;
  the party may enter at `min(bestCleared across members) + 1`, so you can
  pull a friend up one level but not skip the ladder.
- Difficulty is fixed for the life of the instance (reset-on-empty rules
  unchanged).

### 5.2 Heroic tuning (the deterministic transform)
Applied to existing mob records at spawn, driven by a per-dungeon scaling
record in `src/sim/content/` (data, not code):
- Every mob becomes level 20 (elites stay elite).
- Health and damage rebase to the dungeon's level-20 peer (Gravewyrm
  Sanctum trash and bosses are the calibration anchor).
- Mechanics keep their identity; magnitudes rebase with damage.
- Loot: the normal table still rolls, plus a heroic bonus table on the
  final boss (rare gear from the L20 pool, small epic chance), the forge
  roll (5.5), and 1 Badge of Valor (once per dungeon per UTC day, per
  badges.md).

### 5.3 Mythic+ scaling
- Starts at keystone level 2 (heroic is effectively level 1).
- Enemy health and damage multiply by a compounding factor per level
  (start at 1.10; data-driven, tune in playtesting; 1.10 is 2.6x at key
  10).
- Affixes activate at thresholds: level 4 one affix, level 7 a second,
  level 10 a third. Declarative records in the delve-affix style
  (examples: enemies enrage below 30% health; non-boss deaths pulse AoE;
  bosses summon adds at 50%). Rotation is seeded per UTC week through
  `Rng` so all hosts agree and replays reproduce.
- **Untimed.** The failure condition is wiping; wipes do not lower the
  unlocked level and the run can be re-pulled. Clearing level N sets
  `bestCleared = max(bestCleared, N)` per character per dungeon.
- Badges: 2 (keys 2 to 4), 3 (keys 5 to 9), 4 (key 10+), consuming the
  same one-paid-kill-per-dungeon-per-day slot as heroic (badges.md 5.1).

### 5.4 Mythic+ chest (the "few times a day, different slots" reward)
- End-of-run chest, personal loot per eligible contributor (the PR #1034
  `worldBossContributors` semantics once it merges; until then, the
  in-tree kill-credit eligibility fan-out in
  `src/sim/combat/damage.ts`).
- Grants one gear piece from the level-20 pool for a **rotating slot
  band**: a seeded weekly rotation cycles which slots the chest favors per
  dungeon (Hollow Crypt week A: waist/feet; week B: helmet/shoulder; and
  so on), so repeat days target different slots.
- Quality scales with keystone level: rare at low keys, epic chance
  rising with level, capped below raid ubiquity.
- Paid chests: first 2 mythic+ clears per character per UTC day (across
  dungeons). Further clears still pay badges and advance `bestCleared`,
  so ladder pushing is never pointless.
- Chest contents get a forge roll (5.5) at the run's keystone level.

### 5.5 Forged drops (Valeforged / Swiftforged), definitive spec

Every **gear** item (kind weapon or armor with a slot) that drops from a
heroic final boss, a heroic bonus table, or a mythic+ chest rolls once on
the forge table at drop time, through `Rng`, server-authoritatively:

| Tier | Effect | Heroic chance | Mythic+ chance (key N) | Cap |
|---|---|---|---|---|
| Valeforged | the item is upgraded by **+2 item levels**: every stat (armor included) scales by the item-level budget curve, section 5.5.1 | 12% | 12% + 2% per key level | 40% |
| Swiftforged | `moveSpeedPct` rolled from 3%, 4%, or 5% (no stat bonus; speed is the whole prize) | 4% | 4% + 1% per key level | 15% |

#### 5.5.1 What "+2 item levels" computes to
The game has no explicit item-level field; budgets are the empirical
peer convention (`src/sim/content/items.ts`). Valeforged formalizes the
minimum needed: an item's **implicit level** is the level of the content
that drops it (20 for everything in scope here), and its stats already
embody that level's budget. Upgrading by 2 levels scales every stat and
armor value by `(L + 2) / L`, rounded to nearest, with a guard that the
total non-armor stat gain is at least 2 points. At L20 that is +10%: a
14-point rare boot becomes roughly 15 to 16 points, an 18-point epic
chest becomes 20, armor rises 10%. The scaled deltas are frozen into the
forge payload at drop time (5.6); the formula generalizes unchanged if
content above L20 ever exists.

#### 5.5.2 Roll and stacking rules
- Tiers are exclusive per drop; roll Swiftforged first, else Valeforged,
  else base. Fixed `Rng` draw order (determinism). Whether one item can
  ever be both is open question 6.
- The Swiftforged magnitude (3/4/5) is a second `Rng` draw, uniform at
  heroic; mythic+ weights shift toward 5% as the key level rises
  (weights data-driven in the forge record).
- **Speed does not stack:** `moveSpeedMult()` applies only the single
  highest equipped Swiftforged bonus (the classic minor-speed-enchant
  rule). Two Swiftforged pieces are a re-gear choice, not an additive
  win; this keeps 8 slots from compounding into +40% and keeps PvP sane.
- Valeforged stat gains stack normally across slots (they are just
  stats).
- Forged drops are **bind-on-pickup**: the drop sets
  `instance.boundTo` to the looter (the field #1165 already provides),
  and the market's existing block on instanced items keeps them
  unlistable with zero new market code (open question 4 revisits
  trading).
- Forge bonuses apply on top of the item's base def at stat-recalc time;
  the base `ItemDef` is never mutated (content stays static data).
- Why a speed stat: no base item grants movement speed, so Swiftforged is
  a genuinely new chase axis that does not raise the combat power ceiling.
  It is the "do even more runs" hook.

### 5.6 Data model: forge rides the professions item-instance payload

Forge is expressed through `ItemInstancePayload` (#1165), not a parallel
mechanism:

- `ItemInstancePayload` gains
  `forge?: { tier: 'valeforged' | 'swiftforged', moveSpeedPct?: number }`.
  Valeforged bakes its scaled stat values from the 5.5.1 formula into the
  existing `rolled.stats` (matching the professions semantics for rolled
  copies, aligned at implementation) and records the tier in `forge` for
  display; Swiftforged carries only the rolled `moveSpeedPct`. The
  concrete numbers are frozen at drop time, so later tuning never mutates
  already-dropped items.
- Forged slots never stack (`count` stays 1), which #1165 instanced
  slots already guarantee; `cloneInvSlot` deep-clone discipline applies
  unchanged at every save/load boundary.
- **Equipment carries the instance (the enabling change):** a parallel
  map `equipmentInstance: Partial<Record<EquipSlot, ItemInstancePayload>>`
  beside `PlayerEquipment`, so every existing itemId code path (vendor,
  tooltips by id, wire) keeps working untouched; equip/unequip moves the
  payload with the item. This also future-proofs equipping signed or
  charged professions items.
- `recalcPlayerStats()` folds the equipped `rolled.stats` after the
  base-item loop; `moveSpeedMult()` reads the highest equipped
  `forge.moveSpeedPct`.
- Persistence: `equipmentInstance` rides the JSONB `CharacterState`
  (serialize / `addPlayer` backfill to empty); `InvSlot.instance` already
  persists via #1165. Old saves load unchanged.
- Wire: instance payloads ship with inventory and equipment snapshots for
  the owning player; other players' paperdolls do not need forge data in
  v1.
- Loot wire: `LootSlot extends InvSlot`, so the pre-rolled `instance`
  rides existing loot slots and the client tooltip can show the bonus
  before pickup (the roll happened at drop, not at loot).

### 5.7 Ladder
- Leaderboard per dungeon: best cleared keystone level, ties broken by
  earliest clear (tick time from the host clock event, never `Date.now`
  in sim). Reuses `leaderboard_page.ts` pagination.

### 5.8 Persistence summary
`CharacterState` (JSONB) additions, standard serialize/backfill pattern:
- `mythicBest: Record<string, number>` (dungeonId to best cleared level)
- `mythicDaily: { date: string, paidChests: number }`
- `equipmentInstance` (5.6); forged bag items ride the existing
  `InvSlot.instance` persistence from #1165
- heroic/mythic+ paid-kill state lives in `badgeDaily` (badges.md)

### 5.9 Determinism and architecture invariants
- All scaling multipliers, affix definitions, slot rotations, and forge
  tables are declarative records in `src/sim/content/` merged by
  `data.ts`.
- Every roll (chest contents, affix rotation, forge) goes through `Rng`
  in a fixed draw order; weekly rotation seeds derive from the UTC week
  string, not wall clock.
- The difficulty transform is a pure function of (mob record, scaling
  record, keystone level) in a new module
  `src/sim/instances/difficulty.ts`; the forge roll is a pure function of
  (item def, difficulty, rng) in `src/sim/loot/forge.ts`. Both
  unit-testable without a world.
- `IWorld` gains the difficulty read surface (current instance
  difficulty, best levels, chest gate state) implemented in both `Sim`
  and `ClientWorld` before UI consumes it.

## 6. Localization

Deliberately small:
- Dungeon, mob, and mechanic names are unchanged and already localized.
- Chest gear reuses existing L20 items: no new item-name translations.
- Affix names and difficulty labels ("Heroic", "Mythic+ 7") are
  sim-emitted player text: stable keys re-localized via
  `src/ui/sim_i18n.ts` / `server_i18n.ts` in the same change (S3 guard);
  affix effects surfaced as auras also need the `AURA_NAME_KEY` path.
- Forge presentation is **client-side only in v1**: the tier label
  ("Valeforged", "Swiftforged") and the bonus lines ("+1 Strength",
  "+3% Movement Speed") render in the item tooltip from wire data via
  `t()` keys; chat/loot messages keep the base item name, so no sim
  matcher work for forge. The tier could later become a name suffix; that
  is an i18n cost deferred deliberately.
- Wiki: `npm run wiki:content` plus `guide.*` prose for the difficulty
  and forging pages.

## 7. Testing and acceptance

- Difficulty transform as a pure function: levels, health, damage,
  mechanic magnitudes against the scaling record.
- Keystone gating: `bestCleared + 1`, the party-minimum entry rule.
- Forge roll: distribution sanity at fixed seeds, draw-order stability
  (two sims, same seed, identical forges), tier exclusivity, chance caps,
  the Swiftforged 3/4/5 magnitude weighting.
- The 5.5.1 scaling formula as a pure function: +10% at L20, rounding,
  the minimum +2 total stat-point guard, armor scaling.
- Forge application: recalc folds Valeforged deltas; only the highest
  Swiftforged speed applies; unequip removes it; forged items reject
  market listing.
- Persistence: roundtrip of `mythicBest`, `mythicDaily`,
  `equipmentInstance`, and forged `InvSlot.instance` payloads;
  pre-feature saves backfill clean.
- Chest: slot-rotation determinism across hosts; daily gate rollover;
  `utcDay === ''` inertness.
- Golden/parity: a scripted heroic Hollow Crypt clear in the existing
  golden-test style to lock rng draw order; new SimEvents golden-tested;
  `cross-platform-sync` pass for IWorld and wire drift.
- Gates: `tests/architecture.test.ts`,
  `tests/localization_fixes.test.ts`, `tests/guide.test.ts`.

## 8. Phasing

1. **P1, heroic:** difficulty key on instances, the transform module,
   Hollow Crypt heroic tuning record, badge hook (1/day), tests. Ships
   value with one dungeon and unblocks badges.md P1. Fully specified
   with verified anchors in `docs/prd/ENDGAME_PHASE1_HANDOFF.md`.
2. **P2, heroic everywhere + forge foundation:** Sunken Bastion and
   Gravewyrm records, heroic bonus tables, the equipment-instance change
   plus the `forge` payload field (5.6), forge rolls on heroic drops.
   The data-model change is taste-and-risk critical (save-format
   surface): fable/opus, not codex.
3. **P3, mythic+:** keystone levels, scaling, `mythicBest`, chest with
   slot rotation and daily gate, forge scaling by key level.
4. **P4, affixes + ladder:** affix records (authoring slice suitable for
   codex against this spec), weekly rotation, leaderboard sort key, UI
   polish (tooltip forge display, difficulty banner).

## 9. Open questions

1. Compounding factor 1.08 vs 1.10 per level (playtest).
2. Party-minimum entry: +1 (proposed) or +2 carry allowance.
3. Chest slot rotation per dungeon per week (proposed) vs per character.
4. Forged item trading: locked in v1; if unlocked later, the market wire
   and listing UI must learn to show forge data (deferred cost, noted).
5. Swiftforged in arena/fiesta: does +5% move speed need a PvP dampener,
   or is the no-stacking rule enough?
6. Double-forging: can one item roll Valeforged and Swiftforged together?
   Locked to exclusive in v1; if opened later it should be mythic+-only
   and very rare.
7. Forge chance caps (40% / 15%): generous enough to feel, rare enough to
   chase? Revisit with drop telemetry.
