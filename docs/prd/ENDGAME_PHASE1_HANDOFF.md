# Implementation Handoff: Endgame Retention, Phase 1 (Heroic + Badge Hook)

| | |
|---|---|
| **Status** | Ready to implement (do not start slices without operator go-ahead) |
| **Source PRDs** | `docs/prd/heroic-mythic-dungeons.md` section 8 P1, plus the minimal `docs/prd/badges.md` P1 slice heroic needs (counter, daily gate, heroic hook) |
| **Scope** | Heroic difficulty for ONE dungeon (The Hollow Crypt), the pure difficulty transform, the Badge of Valor counter with its daily gate, and the 1/day badge on the heroic final boss. NO mythic+ (P3), NO forge or equipment-instance change (P2), NO vendor stock (badges P2), NO raid/world-boss/delve badge sources (badges P1 proper), NO heroic bonus loot table (P2). |
| **Verified against** | the PR branch point c40c417d (the #1174 professions merge on `release/v0.20.0`) on 2026-07-03. Line numbers WILL drift: re-find every anchor before editing; trust the symbol, not the line. |
| **Executor routing** | Slices S1 to S6 and S8: mechanical against this spec (codex-suitable), reviewed before merge. S7 (UI, taste) and S9 (integration): Claude. |

---

## 0. Ground rules (paste into every slice prompt)

1. `src/sim/` never imports from `render/`, `ui/`, `game/`, `net/`, or any
   DOM/Three API. Guarded by `tests/architecture.test.ts`.
2. All sim randomness goes through the sim's `Rng` (`ctx.rng` / `this.rng`).
   Never `Math.random`, `Date.now`, `performance.now` in sim logic. Calendar
   gates read the host-injected `ctx.utcDay` and are inert when it is `''`.
3. Every player-visible string is i18n: sim/server emit stable event data or
   English literals that MUST have a matcher entry (`src/ui/sim_i18n.ts` /
   `src/ui/server_i18n.ts`); UI strings are `t()` keys added to
   `src/ui/i18n.catalog/` (English only, never edit `i18n.locales/` overlays).
   The S3 guard is `tests/localization_fixes.test.ts`.
4. TypeScript strict, ESM, 2-space indent, match surrounding style. No em
   dashes, en dashes, or emojis anywhere, including comments and commits.
5. Conventional Commits with scope, e.g. `feat(dungeons): ...`,
   `feat(badges): ...`.
6. New sim behavior is a sibling module behind the `SimContext` seam
   (`src/sim/sim_context.ts`), never a new method cluster on `sim.ts`.
   Content is declarative records in `src/sim/content/` merged by `data.ts`.
7. Anchor completion on the slice's acceptance commands, not on "looks done".

## 1. Shared design constants (defined once in S1/S3; imported, never redefined)

```ts
// src/sim/instances/difficulty.ts (S2, pure module)
export type DungeonDifficulty = 'normal' | 'heroic';   // mythic+ joins in P3

// src/sim/content/heroic.ts (S3, data-as-code, merged by data.ts)
export interface HeroicTuningDef {
  dungeonId: string;
  mobLevel: number;      // 20 in v1 (MAX_LEVEL, src/sim/types.ts:1860)
  hpMult: number;        // calibration knob on top of the per-level rebase
  dmgMult: number;       // both default 1.0 until playtest says otherwise
  finalBossId: string;   // the badge trigger (and the P2 bonus-table hook)
}
export const HEROIC_TUNING: Record<string, HeroicTuningDef> = {
  hollow_crypt: {
    dungeonId: 'hollow_crypt', mobLevel: 20,
    hpMult: 1.0, dmgMult: 1.0,           // tune against the Gravewyrm anchor
    finalBossId: 'morthen',
  },
};
```

Badge tuning (badges.md 5.1, definitive): heroic final boss pays 1 Badge of
Valor, once per dungeon per UTC day per character. Entry is NOT lockout-gated;
only the payout is daily. The mythic+ rates (2/3/4) share this slot later.

## 2. Verified hook-point map

| Concern | Anchor (re-find before editing) |
|---|---|
| Instance slot type | `src/sim/sim.ts:559-567` `InstanceSlot` (`dungeonId, slot, partyKey, mobIds, objectIds, exitId, emptyFor`); no difficulty field today. Pool seeded in the `Sim` ctor `sim.ts:994-1032` (`INSTANCE_SLOT_COUNT` per dungeon) |
| Slot keying | `src/sim/instances/dungeons.ts:34-37` `instanceKeyFor` (party:<id> or solo:<pid>); find/claim predicate `dungeons.ts:106-114` |
| Enter/leave/reset | `enterDungeon` `dungeons.ts:73` (Sim delegate `sim.ts:5338`), `leaveDungeon` `dungeons.ts:166`, `claimInstance` `dungeons.ts:200` (mob level roll `ctx.rng.int(minLevel, maxLevel)` at :207), `freeInstance` `dungeons.ts:249`, empty-timeout sweep `updateInstances` `dungeons.ts:274` |
| Door trigger | `updateDoorTriggers` `dungeons.ts:45` (auto-enter at :67); client interact path `src/game/interactions.ts:125` and `:148` call `world.enterDungeon(e.dungeonId)` |
| Raid lockout check (pattern only) | `isRaidLocked` `dungeons.ts:139-146`; grant `src/sim/encounters/nythraxis.ts:478`. Heroic entry does NOT use lockouts |
| Mob record shape | `MobTemplate` `src/sim/types.ts:495` (minLevel/maxLevel :498, hpBase/hpPerLevel :501, dmgBase/dmgPerLevel :503, boss :512, elite :515, mechanics: aoePulse :521, summonAdds :531, enrage :534, stomp :614, cleave :642, mortalStrike :755) |
| Dungeon records | `DungeonDef` `src/sim/types.ts:1203`, `DungeonSpawn` :1188; registry `DUNGEON_DEFS` `src/sim/content/dungeons.ts:575`; `hollow_crypt` :576-588, spawn list `CRYPT_SPAWN_LIST` :510-521; final boss `morthen` (L10, `boss: true`) :97-125; Gravewyrm L20 calibration anchor :602 |
| Boss-kill hook | `handleDeath` `src/sim/combat/damage.ts:473`, one-shot mob branch :526; precedents in-branch: delve completion `ctx.onDelveBossDefeated` :537 (gate :532), raid lockout grant :547; kill-credit eligibility fan-out :566-609 (pets credit owners) |
| Currency pattern (delveMarks) | `PlayerMeta` field `src/sim/sim.ts:710`, wire-optional `CharacterState` :782, init :1206, backfill :1272, serialize :1473; award `src/sim/delves/runs.ts:651`, spend :1324 |
| Daily-gate pattern (delveDaily) | shape `sim.ts:714` (wire :786), init :1210, load :1276-1282, serialize :1477-1481; rollover `refreshDelveDaily` `src/sim/delves/runs.ts:235-243` (no-op when `utcDay === ''`) |
| utcDay seam | field `sim.ts:904`, ctx surface `src/sim/sim_context.ts:128` (getter :691); server sets it `server/game.ts:1011`, offline client `src/main.ts:2269` via `src/game/utc_day.ts:9` |
| SimContext registration | declare in `SimContextCallbacks` (dungeon block `sim_context.ts:173-181`), bind in `createSimContext` (:725-728) and `Sim.buildSimContext` (`sim.ts:2073` pattern) |
| Command wire | `enter_dungeon` in `COMMAND_NAMES` `src/world_api.ts:275` (facet map :457); ClientWorld sender `src/net/online.ts:2033`; server dispatch case `server/game.ts:2767` (door proximity check :2772-2775, forward :2776) |
| Self snapshot | `selfWireJson` `maybe()` block `server/game.ts:3147-3157` (inv/buyback/equip ship here under `heavyDue`); client apply `src/net/online.ts:1500-1508` |
| SimEvent union | `src/sim/types.ts:1582`; golden/parity harness `tests/parity/scenarios.ts` (`UPDATE_PARITY=1 npx vitest run tests/parity` regenerates; never to hide a diff) |
| Snapshot tests | `tests/snapshots.test.ts` |
| Delve marks HUD (badge row pattern) | `src/ui/hud.ts:5242` and :5621 (formatNumber over `this.sim.delveMarks`) |
| Level cap | `MAX_LEVEL = 20` `src/sim/types.ts:1860` |

## 3. Slices

Dependency order: S1 -> S2 -> S3, then S4 -> S5; S6 after S1 and S4; S7 and S8
after S6; S9 last. S2/S3 and S4 are independent of each other.

### S1. Difficulty on the instance slot and the enter path (sim)
- `InstanceSlot` (`sim.ts:559-567`) gains `difficulty: DungeonDifficulty`;
  the ctor pool (`sim.ts:994-1032`) seeds it `'normal'`.
- `enterDungeon(ctx, dungeonId, pid?, difficulty: DungeonDifficulty = 'normal')`
  (`dungeons.ts:73`, delegate `sim.ts:5338`, ctx callback
  `sim_context.ts:173-181`):
  - An existing party-keyed slot is re-entered AS IS, ignoring the requested
    difficulty (PRD 5.1: difficulty is fixed for the life of the instance).
  - Claiming a free slot stamps `inst.difficulty = difficulty`.
  - Heroic gate: the entering player must be `MAX_LEVEL`; refuse with a
    `ctx.error` string from section 4 otherwise. No lockout, no daily entry
    cap (only the badge payout is daily, S5).
  - `freeInstance` (`dungeons.ts:249`) resets `difficulty` to `'normal'`.
- `updateDoorTriggers` (`dungeons.ts:45`) keeps auto-entering at `'normal'`;
  heroic entry arrives only through the explicit command path (S6/S7).
- Tests: new `tests/heroic_instances.test.ts`: free slot claim stamps heroic;
  party member entering after the claim lands in the same heroic instance
  regardless of what they request; re-claim after `freeInstance` is normal
  again; below-cap heroic entry refused; normal entry below cap unchanged.
- Acceptance: `npx vitest run tests/heroic_instances.test.ts tests/architecture.test.ts && npx vitest run tests/parity`
  (parity untouched: no new rng draws on the normal path).

### S2. The pure difficulty transform (sim, pure module)
- New `src/sim/instances/difficulty.ts`:
  `applyHeroicTuning(template: MobTemplate, tuning: HeroicTuningDef): MobTemplate`
  returns a COPY (never mutate content records): `minLevel` and `maxLevel`
  both set to `tuning.mobLevel` (the existing `ctx.rng.int` roll at
  `dungeons.ts:207` still runs and consumes one draw, so draw order inside
  the claim is unchanged, gotcha G2); `hpBase`/`dmgBase` scaled by
  `hpMult`/`dmgMult`; `boss`/`elite`/immunity flags preserved; mechanic
  magnitudes (aoePulse, stomp, cleave, mortalStrike, summonAdds counts,
  enrage) ride the damage rebase, identity untouched.
- `claimInstance` (`dungeons.ts:200`) applies the transform when
  `inst.difficulty === 'heroic'` and `HEROIC_TUNING[dungeonId]` exists;
  a heroic claim for a dungeon with no tuning record falls back to normal
  (defensive; S3 ships the only record).
- Tests: new `tests/heroic_transform.test.ts` imports the pure module
  directly: level pin to 20, hp/dmg scaling, flag preservation, input
  template not mutated, magnitude rebase per mechanic field.
- Acceptance: `npx vitest run tests/heroic_transform.test.ts tests/architecture.test.ts`.

### S3. Hollow Crypt heroic tuning record (content, data)
- New `src/sim/content/heroic.ts` with `HeroicTuningDef` + `HEROIC_TUNING`
  exactly as section 1; merged by `data.ts` like other content modules.
- `finalBossId: 'morthen'` (the only `boss: true` template in
  `CRYPT_SPAWN_LIST`, `dungeons.ts:97-125` and :510-521).
- Calibrate `hpMult`/`dmgMult` so heroic Hollow Crypt trash and boss land at
  the Gravewyrm Sanctum L20 peer feel (`dungeons.ts:602` roster is the
  anchor); start at 1.0 and adjust only from the per-level rebase gap, do
  not invent balance numbers beyond that calibration.
- Acceptance: `npx vitest run tests/heroic_transform.test.ts` (extend with a
  record-shape pin: every `HEROIC_TUNING` entry names an existing dungeon
  and an existing `boss: true` template in that dungeon's spawn list).

### S4. Badge counter and daily gate (sim, new module)
- New `src/sim/progression/badges.ts` behind `SimContext` (sibling of
  `progression/xp.ts`); state lives on `PlayerMeta`, module owns the logic.
- `PlayerMeta` gains `badges: number` and
  `badgeDaily: { date: string; dungeonPaid: Record<string, boolean> }`,
  following the delveMarks/delveDaily pattern verbatim: field beside
  `sim.ts:710`/:714, wire-optional `CharacterState` beside :782/:786, init 0
  and `{ date: '', dungeonPaid: {} }` beside :1206/:1210, backfill beside
  :1272/:1276, serialize beside :1473/:1477.
- `refreshBadgeDaily(ctx, meta)` mirrors `refreshDelveDaily`
  (`runs.ts:235-243`): rolls only when `ctx.utcDay` is non-empty and differs
  from `badgeDaily.date`; inert when `utcDay === ''` (offline/headless
  replay stays reproducible).
- `awardHeroicBadge(ctx, meta, dungeonId): number` returns the amount paid
  (0 when the day slot is spent) and marks `dungeonPaid[dungeonId]`.
- Tests: new `tests/badges.test.ts`: pays 1 once per dungeon per day, 0
  after; a second dungeon the same day still pays; rollover on `utcDay`
  change; inert on `''`; serialize/addPlayer round-trip; pre-badge saves
  backfill to 0 (the badges.md section 7 list, minus the sources P1 does
  not ship).
- Acceptance: `npx vitest run tests/badges.test.ts tests/architecture.test.ts`.

### S5. The heroic badge hook on the final-boss kill (sim)
- In `handleDeath`'s one-shot mob branch (`damage.ts:526`), beside the delve
  completion precedent (:537) and the raid lockout grant (:547): when the
  dead mob's template id equals `HEROIC_TUNING[dungeonId].finalBossId` and
  the mob belongs to a heroic instance, award 1 badge per eligible player.
- Instance resolution: the mob's instance slot (via `ctx.instances` /
  `InstanceSlot.mobIds`) carries `difficulty` from S1.
- Eligibility: the SAME contributor set as the existing kill-credit fan-out
  at `damage.ts:566-609` (party members in range, pets credit owners). Do
  NOT reference `worldBossContributors`: it does not exist in this tree
  (gotcha G1).
- Emit a personal SimEvent `badgeGain { pid, amount }` (union at
  `types.ts:1582`) for FCT/system line; golden-test it.
- Tests: extend `tests/badges.test.ts`: scripted heroic Hollow Crypt kill of
  morthen pays each eligible party member once; normal-difficulty morthen
  pays zero (badges.md pillar 1 regression pin); second heroic kill the same
  day pays zero; pet kill credits the owner.
- Acceptance: `npx vitest run tests/badges.test.ts && npx vitest run tests/parity`
  (add a `heroic_hollow_crypt` scenario to `tests/parity/scenarios.ts` and
  record it once with `UPDATE_PARITY=1`; existing goldens must not change).

### S6. Seam: IWorld, wire, server dispatch (net/server)
- `IWorld.enterDungeon` gains an optional difficulty argument
  (`world_api.ts`, command registry :275 / facet map :457). Offline `Sim`
  already satisfies it after S1.
- `ClientWorld.enterDungeon` (`online.ts:2033`) sends
  `{ cmd: 'enter_dungeon', dungeon, difficulty }`; server dispatch
  (`server/game.ts:2767`) validates `difficulty` against the literal union
  (reject anything else; server-authoritative, never trust the client
  string) and forwards to `sim.enterDungeon(dungeonId, pid, difficulty)`.
- `badges` ships self-only in `selfWireJson` via the `maybe()` pattern
  (`server/game.ts:3147-3157`), private like copper; `ClientWorld` mirrors
  it in `applySnapshot` (`online.ts:1500-1508` area) and exposes the same
  read accessor `Sim` gets (e.g. `badges: number` on the world), plus the
  current instance difficulty read the HUD needs (derive on `Sim` from the
  player's instance; mirror the value on `ClientWorld`).
- Tests: extend `tests/snapshots.test.ts` with the badges self-state mirror;
  cross-check both worlds expose identical IWorld surface (the
  `cross-platform-sync` reviewer in S9 audits this).
- Acceptance: `npx vitest run tests/snapshots.test.ts tests/architecture.test.ts`.

### S7. Minimal UI: difficulty choice and badge visibility (Claude, taste)
- Door flow: `src/game/interactions.ts:125`/:148 currently auto-call
  `world.enterDungeon(e.dungeonId)`. For a `MAX_LEVEL` player interacting
  with a door that has a `HEROIC_TUNING` record, offer Normal / Heroic
  (smallest possible chrome; reuse an existing confirm/prompt pattern, no
  new window). Below cap or no record: unchanged auto-enter.
- Badge count: render beside the delve marks pattern
  (`hud.ts:5242`/:5621 style, `formatNumber`, no raw concat), wherever the
  currency naturally lives until badges P3 does the full pass (character
  sheet row acceptable for P1).
- `badgeGain` event: FCT float plus system line via the matcher path.
- All strings from section 4; English catalog only.
- Acceptance: `npx vitest run tests/localization_fixes.test.ts` plus the
  i18n completeness test if new catalog keys were added (rebuild and commit
  the generated i18n files, gotcha G6); manual: `npm run dev`, enter heroic
  Hollow Crypt at cap, kill morthen, see the badge float.

### S8. Guide/wiki sync (content)
- `npm run wiki:content`; add the `guide.*` prose keys the generator demands
  for heroic difficulty and the badge currency (English only, spoiler-safe,
  per `src/guide/CLAUDE.md`).
- Acceptance: `npx vitest run tests/guide.test.ts`.

### S9. Integration pass (Claude)
- Full gates: `npx vitest run tests/architecture.test.ts tests/localization_fixes.test.ts && npx vitest run tests/parity && npm test && npm run build`.
- Spawn the repo reviewers on the combined diff: `architecture-reviewer`
  (rng draw order, tick phases, SimContext contract), `cross-platform-sync`
  (IWorld / wire / event parity across Sim and ClientWorld),
  `privacy-security-review` (server authority on the difficulty command),
  `qa-checklist` (end-of-contribution gate).

## 4. New player-facing strings (complete list; the S3 i18n guard will check)

Sim `ctx.error` literals (each needs a `sim_i18n.ts` matcher entry in the
SAME slice that adds it):
- `You must be at the level cap to enter a heroic dungeon.` (S1)
- `Heroic mode is not available for this dungeon.` (S1, defensive)

SimEvent-driven text (S5/S7): the badge award line
(`You receive 1 Badge of Valor.` shape) renders client-side from the
`badgeGain` event via `t()`; if the server relays it as text instead, it
needs the `server_i18n.ts` matcher in the same change.

UI keys (S7): difficulty prompt title and the two option labels
(`Normal` / `Heroic`), the badge currency label (`Badges of Valor`), FCT
float (`+{amount} Badge of Valor`). Keep the set this small on purpose
(badges.md section 6: the vendor and its 10 item names are P2 and carry the
real i18n cost; do not pull them forward).

## 5. Gotchas (read before every slice)

- **G1, the world boss does not exist here.** `worldBossDaily`,
  `worldBossContributors`, `isWorldBossLootEligible`, and Thunzharr have ZERO
  hits in `src/` and `server/` on this base: they land with PR #1034 (open,
  unmerged). Both PRDs cite them as precedent; treat every such citation as
  "the #1034 sibling pattern", not as in-tree code. The in-tree precedents
  to copy are delveDaily (`runs.ts:235`) and the kill-credit fan-out
  (`damage.ts:566-609`). The badges.md world-boss earning row is BLOCKED on
  #1034 and is out of this phase.
- **G2, rng draw parity.** `claimInstance` rolls each mob's level
  (`dungeons.ts:207`). The heroic transform keeps that draw by pinning
  minLevel = maxLevel = 20 rather than skipping the roll, so normal-path
  goldens never shift. Any golden that reds is a code bug, never a reason
  to `UPDATE_PARITY=1` an existing scenario.
- **G3, `onBossDeath` is not one-shot.** `src/sim/encounters/nythraxis.ts:148`
  is called EVERY TICK for dead mobs from `mob/locomotion.ts:59` and is
  Nythraxis-only. The badge hook belongs in `handleDeath`'s once-only mob
  branch (`damage.ts:526`), beside the delve and raid precedents.
- **G4, there is no party-leader gate on entry.** `enterDungeon` takes one
  pid; whichever member enters first claims the party-keyed slot
  (`instanceKeyFor`, `dungeons.ts:34-37`). PRD 5.1's "party leader sets the
  difficulty" is satisfied in v1 by "the first entrant stamps it, fixed for
  the instance's life"; the prompt UI (S7) is the only leader-ish surface.
  Revisit when mythic+ keystone gating (P3) needs real leader checks.
- **G5, there is no dungeon-completion event.** Standard dungeons have no
  completion detection; the only `boss: true` in Hollow Crypt is `morthen`.
  The badge trigger keys on the tuning record's `finalBossId`, not on a
  completion concept. Do not invent one in P1.
- **G6, i18n gates bite.** New catalog keys fail the completeness test when
  the generated files are not rebuilt and committed (`npm run i18n:scan &&
  npm run i18n:build`, commit `i18n.resolved.generated/` + the status
  summary). Never hand-edit locale overlays. Run
  `tests/localization_fixes.test.ts` locally before pushing.
- **G7, no weekly seam exists.** `utcWeek` has zero hits; only `utcDay`
  (`sim.ts:904`) and epoch-ms lockouts exist. P1 does not need weeks; the
  mythic+ chest rotation (P3) must add a host-injected UTC-week string
  modeled on the utcDay seam, never derive it from wall clock in sim.
- **G8, do not touch equipment instances in P1.** `PlayerEquipment` maps
  slot to a bare item-id string (`src/sim/entity.ts:139`) and
  `recalcPlayerStats` reads only `ITEMS[itemId].stats`
  (`entity.ts:177-197`). That enabling change is P2's forge foundation
  (taste-and-risk critical per the PRD phasing) and is out of scope here.
- **G9, worktree discipline.** Build each slice in a fresh worktree under
  `.claude/worktrees/` off the PR base branch, branch
  `feature/endgame-p1-s<N>`.

## 6. What P1 deliberately leaves on the table (so nobody "helpfully" adds it)

- Mythic+ (keystones, scaling, affixes, chest, ladder): P3/P4.
- Forge rolls and the equipment-instance payload: P2.
- Heroic bonus loot table on the final boss: P2 (heroic v1 pays the normal
  table plus the badge; that is enough to validate the loop).
- The Badge Quartermaster, its 10 items, and their all-locale names: badges
  P2 (the single largest i18n cost in the pair; see badges.md section 6).
- Raid, world-boss (#1034), and delve badge sources: badges P1 proper, after
  this phase proves the counter and gate shapes.
