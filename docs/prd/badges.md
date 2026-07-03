# PRD: Badges of Valor (Endgame Currency and Quartermaster Vendor)

Status: draft v3 (anchor verification pass against release/v0.20.0 on
2026-07-03: the world-boss precedents cited below live in PR #1034, open
and not merged; every other cited anchor verified in-tree)
Owner: design
Companion docs: `docs/prd/heroic-mythic-dungeons.md` (the primary badge
earner and the forged-drop system) and
`docs/prd/ENDGAME_PHASE1_HANDOFF.md` (the verified phase 1
implementation handoff: heroic Hollow Crypt plus the badge counter and
its heroic hook)

## 1. Summary

A deterministic endgame currency, the **Badge of Valor**, awarded for
clearing max-level group content: heroic and mythic+ dungeons, the
Nythraxis raid, the world boss, and delve clears. Badges are spent at a new
**Badge Quartermaster** NPC selling level-20 gear and cosmetics. The point
is retention math the player can see: a bad-luck run still pays, and "N
more runs until the epic chest" is always a concrete, plannable number.

Design reference: the classic-era "Badge of Justice" model, where the end
boss of cap-level content pays a predictable token and the vendor stock
sits slightly below raid drops so raiding stays aspirational.

Design pillars (definitive):
1. **Badges come only from max-level content.** Normal leveling dungeons
   pay zero; nobody should farm a level 8 instance at the cap.
2. **No friction between completion and payout.** The award is on the kill
   or the clear, never behind a chest, lockbox, minigame, or timer.
3. **Deterministic on top of RNG, never instead of it.** Loot tables are
   untouched; badges are the pity layer.

## 2. Background and motivation

### 2.1 The gap
At the level cap (20, which stays the cap) the reward loop is pure RNG:
dungeon and raid loot tables, the daily world boss roll, delve marks
(delve-only sink). A player whose slots are mostly filled has no reason to
run anything again; a player on a bad-luck streak has nothing to show for a
week of runs. Lifetime XP / prestige
(`docs/prd/max-level-xp-overflow.md`) gives cosmetic cadence but no gear
agency.

### 2.2 The fix
Deterministic progress layered on top of existing RNG loot. Every piece of
**max-level** content pays badges on completion, and heroic/mythic+
(companion PRD) turns all three existing dungeons into max-level content,
so the badge faucet and the difficulty system launch as one loop.

## 3. Current state in the codebase (what this reuses)

- **Currency-as-counter precedent:** `delveMarks` on `CharacterState`
  (`src/sim/sim.ts`), spent in the delve shop
  (`src/sim/content/delves/shop.ts`). Badges follow the same shape: a
  counter, not a bag item.
- **Daily-gate precedent:** `delveDaily` (in tree: rollover in
  `refreshDelveDaily`, `src/sim/delves/runs.ts`): UTC-day window keyed off
  the host-provided `utcDay`, no-op when the day is unknown
  (headless/replay stays reproducible). `worldBossDaily` is the same
  pattern arriving with PR #1034 (open, not merged as of 2026-07-03).
- **Weekly-gate precedent:** `raidLockouts` (per-dungeon expiry ms).
- **Contributor derivation:** `worldBossContributors()` (hate-table
  contributors, pets credit owners, sorted by entityId for fixed rng
  order) ships with PR #1034, not this tree. Until it merges, dungeon
  badge awards use the existing kill-credit eligibility fan-out in
  `src/sim/combat/damage.ts` (party members in range, pets credit
  owners); converge on the #1034 helper when it lands.
- **Vendor precedent:** NPC vendors with buy/sell and `vendorBuyback`; the
  delve shop shows a non-copper purchase path.
- **Cosmetic sink with zero new item i18n:** `event_skin_token`
  ("Mysterious Cosmetic Cache", `src/sim/content/items.ts`) already rolls a
  skin rarity server-side and opens the skin-select overlay; it is
  currently dev-grant only. Selling it for badges gives the vendor an
  evergreen, repeatable sink on day one.
- **Stat-budget convention:** no formal budget table exists; items balance
  to peers (see the empirical convention comment in
  `src/sim/content/items.ts`: armor slot-weighted off the chest/legs
  baseline at roughly head 1.0, shoulder 0.75, gloves 0.65, waist 0.55).
  Level-20 anchors in `src/sim/content/zone3.ts`: class-group rare feet at
  14 stat points (armor 68, int 9, spi 5); raid epic chests at 18 to 22
  points (Deathlord Warplate armor 270, str 8, sta 10; Necromancer's
  Starshroud armor 92, int 14, spi 8).

## 4. Goals and non-goals

### Goals
1. Every max-level group activity pays a predictable badge amount on
   completion, server-authoritatively.
2. The vendor turns badges into gear (slightly below raid quality) and
   cosmetics, so both the unlucky and the fully-geared keep running.
3. Daily and weekly gates reuse the existing `utcDay` / lockout patterns;
   determinism and replay reproducibility untouched.
4. The v1 gear stock is a fully specified, self-contained authoring slice
   (section 5.3) suitable for delegation to codex.

### Non-goals
- No level-cap raise; 20 stays the cap.
- No badges from normal (leveling) dungeon runs, ever. They stay the
  leveling path.
- No badge trading, mailing, or market listing (a counter cannot leak into
  the economy).
- No second currency tier in v1 (add a second counter later if the economy
  wants one).
- Delve marks stay as they are: marks buy delve-local upgrades, badges buy
  character gear.
- No open-world biome level scaling (separate PRD if pursued).

## 5. Functional requirements

### 5.1 Earning (definitive table, v1)

| Source | Badges | Gate |
|---|---|---|
| Normal dungeon, any boss | 0 | by design (pillar 1) |
| Heroic dungeon final boss | 1 | 1 paid kill per dungeon per UTC day |
| Mythic+ clear | 2 (keys 2 to 4), 3 (keys 5 to 9), 4 (key 10+) | shares the heroic daily slot per dungeon (one paid dungeon-kill per day, the higher rate applies) |
| Nythraxis raid boss | 3 | rides the existing raid lockout (weekly) |
| World boss (Thunzharr) | 2 | rides the `worldBossDaily` loot gate; blocked on PR #1034 (the boss and its gate are not merged) |
| Delve clear (normal or heroic) | 1 | shares the existing `delveDaily` mark-clear cap |

Rules:
- Awarded to every eligible **contributor**: the PR #1034
  `worldBossContributors` semantics once it merges; until then, the
  in-tree kill-credit eligibility fan-out (section 3).
- The award lands on kill/clear, never on a chest or bonus objective
  (pillar 2). The mythic+ end-of-run chest is a separate gear reward
  (companion PRD); badges do not route through it.
- When `utcDay` is unknown (offline browser world, headless RL env), gates
  are not enforced, mirroring the `refreshDelveDaily` rule (and PR #1034's
  `isWorldBossLootEligible`). Offline play is
  non-authoritative, so nothing leaks into the online economy.
- Faucet model: a daily player clearing 3 heroic/mythic+ dungeons, the
  world boss, and 2 delves earns roughly 8 to 10 per day, plus 3 per week
  from the raid: call it 60 to 70 per week hardcore, about 20 to 25 per
  week for a casual third of that.

### 5.2 Pricing (tuned to the 5.1 faucet)

| Stock class | Price | Cadence check |
|---|---|---|
| Rare gear piece | 10 | casual: one every 3 to 4 days |
| Epic gear piece | 45 | casual: one every ~2 weeks; daily player: ~5 days |
| Mysterious Cosmetic Cache | 30 | evergreen repeatable sink |

Purchases resolve server-side through the vendor buy path with a
`costBadges` field on the stock entry instead of copper; insufficient
badges is a normal vendor rejection.

### 5.3 The Badge Quartermaster stock (full v1 authoring spec)

A new NPC vendor in the zone 3 settlement near the Gravewyrm Sanctum
entrance (exact placement at implementation). Ten gear items plus the
cache. **This table is the implementation spec for the gear slice, which
is delegated to codex** (see phasing): ids, slots, class groups, and stat
points are fixed here; armor values follow the slot-weight convention off
the zone3 class-group baselines; `sellValue` matches zone3 peers (rare
3200, epic 9000); all pieces `noMarketList` (badge gear must not become a
gold printer).

Naming theme: "Valewarden" (plate group), "Mistrunner" (leather group),
"Thornweave" (cloth group), after the Vale / Thornpeak lore already in
zone 3.

| id | Name | Slot | Quality | Classes | Stats (points) | Price |
|---|---|---|---|---|---|---|
| valewarden_girdle | Valewarden Girdle | waist | rare | warrior, paladin, shaman | str 6, sta 5 (11) | 10 |
| valewarden_stompers | Valewarden Stompers | feet | rare | warrior, paladin, shaman | str 7, sta 5 (12) | 10 |
| mistrunner_cord | Mistrunner Cord | waist | rare | rogue, hunter | agi 6, sta 5 (11) | 10 |
| mistrunner_treads | Mistrunner Treads | feet | rare | rogue, hunter | agi 7, sta 5 (12) | 10 |
| thornweave_sash | Thornweave Sash | waist | rare | mage, priest, warlock, druid | int 6, spi 5 (11) | 10 |
| thornweave_slippers | Thornweave Slippers | feet | rare | mage, priest, warlock, druid | int 7, spi 5 (12) | 10 |
| valewarden_breastplate | Valewarden Breastplate | chest | epic | warrior, paladin, shaman | str 8, sta 8 (16) | 45 |
| mistrunner_tunic | Mistrunner Tunic | chest | epic | rogue, hunter | agi 9, sta 8 (17) | 45 |
| thornweave_robe | Thornweave Robe | chest | epic | mage, priest, warlock, druid | int 10, spi 8 (18) | 45 |
| valewarden_crown | Valewarden Crown | helmet | epic | warrior, paladin, shaman | str 7, sta 8 (15) | 45 |
| event_skin_token | Mysterious Cosmetic Cache | (use item) | epic | all | rolls a skin rarity on use (existing behavior) | 30 |

Budget rationale: epic chests sit 2 to 4 stat points below their Nythraxis
equivalents (Deathlord 18, Necromancer's 22, Wyrmshadow 20), so raid drops
stay best-in-slot; rares sit at or just below the zone3 rare anchors,
slot-weighted. Armor values: compute from the class-group zone3 chest
baseline times the slot weight, rounded to the nearest 2.

### 5.4 Persistence and data model

`CharacterState` (JSONB) additions, following the established
serialize / `addPlayer` backfill pattern:

- `badges: number` (init and backfill 0)
- `badgeDaily: { date: string, dungeonPaid: Record<string, boolean> }`:
  one paid heroic-or-mythic+ kill per dungeon per UTC day, rolls over on
  `utcDay` change (the `delveDaily` shape).

Raid sources need no new gate state (they ride the existing
`raidLockouts`); the world boss rides the gate PR #1034 introduces once
it merges. Wire: `badges` ships in the owning player's snapshot only
(private, like copper).

### 5.5 Determinism and architecture invariants

- No new randomness: awards are fixed amounts; the cosmetic cache keeps
  its existing server-side `Rng` roll.
- No `Date.now` in sim logic: the UTC day arrives from the host exactly as
  it does for `delveDaily` (and for PR #1034's `worldBossDaily`).
- New logic is a small module (`src/sim/progression/badges.ts`); the
  quartermaster stock is a declarative record in `src/sim/content/` merged
  by `data.ts`; nothing lands inline in `sim.ts`. Guarded by
  `tests/architecture.test.ts`.
- `IWorld` gains read surface for the badge count and the quartermaster
  stock; implemented in both `Sim` and `ClientWorld` before any UI
  consumes it.

## 6. Localization (budget for it, it is the hidden cost)

- **The 10 new gear items need names in every locale in the same change**;
  experience says English-only item names fail the localization coverage
  test (this is why v1 stock is exactly 10 pieces and why the cosmetic
  sink reuses `event_skin_token` instead of minting a new item). The codex
  gear slice includes drafting all locale overlay entries for maintainer
  review.
- The currency name ("Badge of Valor"), quartermaster NPC name, and any
  server-emitted award line ("You receive 2 Badges of Valor.") follow the
  sim/server rule: sim stays language-agnostic; emit a stable key plus
  values re-localized via `src/ui/sim_i18n.ts` and `server_i18n.ts` in the
  same change (S3 guard: `tests/localization_fixes.test.ts`).
- New HUD strings (currency row, vendor badge pricing label) are `t()`
  keys in the English catalog modules; the i18n completeness gate has
  blocked new catalog keys before, so keep new UI chrome minimal and
  coordinate the locale fill with the release pass.
- Wiki: run `npm run wiki:content` and add `guide.*` prose keys for the
  badge system page (`tests/guide.test.ts` gates freshness).

## 7. Testing and acceptance

Vitest, new `tests/badges.test.ts`:
- normal dungeon bosses award 0 in all difficulties' absence (regression
  pin for pillar 1);
- heroic kill pays 1 once per dungeon per day, 0 after; a mythic+ clear
  consumes the same slot at its higher rate; second dungeon same day still
  pays;
- raid pays 3 on lockout grant only; world boss pays 2 alongside its
  loot-gate check (lands with PR #1034); delve clear pays 1 under the
  mark-clear cap;
- gates roll over on `utcDay` change and are inert when `utcDay` is `''`;
- contributor derivation matches the kill-credit fan-out semantics (pets
  credit owner); converge on PR #1034's `worldBossContributors` when it
  lands;
- vendor purchase deducts badges, grants the item, rejects on insufficient
  badges or full bags; badge gear is not market-listable;
- persistence roundtrip: serialize then `addPlayer` restores `badges` and
  `badgeDaily`; pre-badge saves backfill to 0.

Plus: golden-test any new SimEvent; a `cross-platform-sync` agent pass for
IWorld / wire drift; `tests/architecture.test.ts`,
`tests/localization_fixes.test.ts`, and `tests/guide.test.ts` stay green.

## 8. Phasing (with delegation)

1. **P1, sim core (fable/opus):** counter, `badgeDaily`, award hooks on
   the heroic/mythic+/raid/world-boss/delve paths, persistence, wire,
   tests. Depends on companion PRD P1 (heroic exists first); the
   world-boss hook additionally waits for PR #1034. The heroic entry
   slice (counter, daily gate, heroic hook) is specified with verified
   anchors in `docs/prd/ENDGAME_PHASE1_HANDOFF.md`.
2. **P2, vendor gear (codex / gpt-5.5 slice):** the 10 items from the 5.3
   table plus all-locale names, quartermaster NPC + stock record, badge
   purchase path, purchase tests. The 5.3 table is the complete spec;
   review by fable before merge.
3. **P3, UI (taste-critical, stays on fable/opus):** currency display in
   the character sheet and vendor window badge pricing, award floating
   combat text, wiki page.
4. **P4, follow-ons:** arena win badges (daily-capped, pending PvP
   population), a second currency tier if needed, badge-priced vanity pet
   or mount when those systems exist.

## 9. Open questions

1. Vendor placement: zone 3 settlement (proposed) vs a quartermaster in
   each zone hub.
2. Should epic vendor pieces require one Nythraxis kill as an attunement
   nod, or stay purely badge-priced? (Leaning purely badge-priced:
   friction pillar.)
3. World boss at 2 vs 3: revisit once real faucet telemetry exists.
4. Cache at 30: too cheap once players are epic-capped? Could rise to 40
   with a weekly first-purchase discount instead.
