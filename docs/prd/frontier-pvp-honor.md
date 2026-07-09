# PRD: Frostreach Frontier (Open PvP Zone), Honor, and the $WOC Stakes Layer

| | |
|---|---|
| **Status** | Draft v2 (v1 free loop + the $WOC stakes layer and agent posture) |
| **Owner** | design |
| **Created** | 2026-07-03 |
| **Design reference** | Classic-era Wintergrasp / world PvP zones (two teams, contested objectives, honor currency, timed zone events); the degen-gaming thesis and Cambria's extraction loop (risk-native design, seasons, tunable rake) for the stakes layer |
| **Related systems** | Duel/arena hostility (`src/sim/social/duel.ts`, `src/sim/social/arena.ts`, `isHostileTo`), world boss (`src/sim/world_boss.ts`), rare spawns (`MobTemplate.rare`), currencies (`copper`, `delveMarks` on `CharacterState`), vendors (`NpcDef.vendorItems`), realms (`server/realm.ts`), instance x-bands (`src/sim/data.ts`), wallet verification (`docs/prd/woc/wallet-link.md`), headless RL env (`headless/`, `python/`) |
| **Companion docs** | `docs/prd/badges.md` (deterministic-currency precedent), `docs/prd/heroic-mythic-dungeons.md`, `docs/prd/woc/holder-cosmetic-flair.md` |
| **Implementation handoff** | `docs/prd/FRONTIER_PHASE1_HANDOFF.md` (Phase 1 slices, verified hook points, executor routing) |

---

## 1. Summary

The **Frostreach Frontier** is a persistent, always-on open-world PvP zone that any
character level 15+ can enter from the overworld. On entry a player is assigned to
one of two teams, **Azure** (blue) or **Crimson** (red), gets a visible team banner
on their back, and is automatically flagged hostile to the opposite team for as long
as they are in the zone. The zone is dense with things worth fighting over: resource
nodes to harvest, rare spawns, a world boss, and a rotating **hourly event**.

Alongside the zone we introduce **Honor Points**, a new account currency earned by
killing enemy players and participating in Frontier content, spent at each team's
**Honor Quartermaster** on PvP gear, consumables, and team cosmetics.

The extraction hook: resources you harvest in the Frontier are **carried, not
banked**. They ride on your character as visible cargo, drop for the enemy when you
die, and only become yours when you turn them in at your team's base. Every full
cargo bag walking home is a PvP objective.

The zone runs as **two loops on one design**. The **free loop** (sections 5 to 9)
is always on, on every realm, with play stakes: the on-ramp, the skill-builder,
and the identity layer. The **$WOC stakes layer** (section 12) reruns the same
extraction loop as bounded, deposit-to-play **staked seasons** where cargo
settles to $WOC, plus a sanctioned **agent server** where automation is a
first-class way to play. The stakes layer never touches `src/sim/`: the sim
deals in cargo, honor, and copper only, and the token bridge lives at the server
boundary (the token firewall, section 12.2).

All outcomes resolve in the authoritative `Sim`; clients mirror via `IWorld` /
`ClientWorld`. Content is declarative in `src/sim/content/`.

## 2. Realm or zone? (resolving the framing)

The pitch says "realm", and the repo does support multiple realms
(`server/realm.ts`, `npm run realms`, `REALM_TYPE: 'PvP'`). But realms are isolated
shards: characters, friends, and guilds are scoped per realm, and there is no
cross-realm travel. Shipping Frostreach as a realm would mean players start blank
characters there and abandon their mains.

**Decision: ship it as a zone.** Frostreach is a new spatial band inside every
realm's world (like arena and delves). Entry is by teleport from the existing
Arena window (the `G` keybind, `src/game/keybinds.ts` id `arena`), which grows
into the general PvP window: the Ashen Coliseum queue section plus a Frostreach
Frontier section with an Enter button, your team, honor balance, and the next
event countdown. This preserves the whole point: your level-20 main, its gear,
and its guild all matter in the Frontier.

The realm framing does return in one place: the **agent server** (section 12.6)
is a dedicated realm where automation is sanctioned, because realms are exactly
the isolation boundary that stance needs. And a `REALM_TYPE='PvP'` shard where
the *entire overworld* uses Frontier flagging rules remains a
config-plus-small-code follow-up (section 13), not v1.

## 3. Current state in the codebase (what this reuses and what is new)

| Concern | Exists today | Gap for this feature |
|---|---|---|
| PvP hostility | `isHostileTo` gates on active duels and arena matches only | Add a third gate: both players inside the Frontier band and on opposite teams |
| Teams | `ArenaMatch { teamA, teamB }`, per-match, ephemeral | Persistent per-character team assignment (`frontierTeam` on `CharacterState`) |
| World boss | `src/sim/world_boss.ts`: interval spawns, personal loot, daily gate via `PlayerMeta.worldBossDaily` | Add a Frontier boss entry to `WORLD_BOSSES` (or an event-driven spawn, section 8) |
| Rare spawns | `MobTemplate.rare` + `elite` + `respawnMult`, exclusive loot roll groups (Brutok pattern) | New Frontier rare templates; no engine work |
| Gathering | None. Only quest sparkle pickups (`ground_pickup_lines.ts`) | New: resource node entity type + gather channel + carried cargo (section 6) |
| Currency | `copper`, `delveMarks` counters on `CharacterState`; vendor via `NpcDef.vendorItems` + `sim.buyItem` | New `honor` counter, same pattern; honor-priced vendor stock |
| Timed events | `worldBossNextAt` sim-time scheduler in `sim.ts` | Generalize into a Frontier event scheduler (hourly, Rng-picked, section 8) |
| Spatial bands | Overworld x in [-180, 180]; dungeons 900+; arena 4200+; delves 4800+ (delve band is open-ended along x today) | New Frontier band, `FRONTIER_X_MIN = 9000` (leaves headroom for delve growth; `isDelvePos` must gain an upper bound, see handoff gotcha G1) |
| PvP rewards | Duel/arena kills grant nothing (no XP, no loot) | Honor grants on player kill, with diminishing returns (section 7) |
| Back attachment (flag) | `src/render/characters/` template system | Team banner attachment tinted per team, plus nameplate tint |
| Wallet identity | `docs/prd/woc/wallet-link.md`: non-custodial Solana wallet verification | Season deposits/settlement (server boundary only, section 12.2); custody design is its own doc |
| Agents / automation | Headless RL env (`headless/env_server.ts`, `python/`), one sim in three hosts | The agent server realm (section 12.6) and the economy wind tunnel (section 12.7) |

## 4. Goals and non-goals

### Goals
- An always-on PvP sandbox at endgame (15 to 20, tuned for 20) with intrinsic
  reasons to fight: nodes, rares, boss, events, cargo.
- **Honor Points**: a deterministic PvP currency, and an Honor Quartermaster per
  team base with gear, consumables, and cosmetics.
- Automatic, unambiguous flagging: inside the zone you are hostile to the other
  team, outside you are not. No flag toggles, no spillover into the overworld.
- Team assignment that is balanced, sticky, and abuse-resistant.
- The extraction loop: harvest, carry, defend, turn in.
- An hourly event system that reshuffles the zone every hour and gives players a
  reason to log in "for the top of the hour".
- Identical behavior online, offline, and headless (the RL env gets a PvP zone for
  free, which is a genuinely interesting training environment).
- **The stakes layer (phased, section 12)**: deposit-to-play $WOC staked seasons
  on the same loop, a sanctioned agent server, and a headless economy red-team
  harness that gates every season parameter change. Risk-native, not a wager
  bolted on top: the extraction loop IS the risk loop.
- **The token firewall as an invariant**: $WOC and wallets never enter
  `src/sim/`; the complete game is playable with zero money attached.

### Non-goals
- Siege weapons, destructible walls/gates, vehicles (the full Wintergrasp fortress
  siege). The event framework leaves room for it (section 8 backlog).
- Ranked ratings or matchmaking. Honor is a currency, not a rating; staked
  seasons bracket by deposit, not skill rating.
- Cross-realm queueing or realm merging.
- Professions/crafting. Frontier resources are turn-in valuables in v1, not
  crafting mats (future hook, section 13).
- Battleground-style instanced matches with win conditions. The zone is persistent.
- Pure-chance casino mechanics (slots, lockboxes, coin flips). The stakes layer
  stays skill-forward: stat-check combat where bad players can beat good players
  in a fight but skill has the EV edge over a season.
- Liquid honor. Honor never trades and never bridges to $WOC, in any mode, ever
  (section 12.3).
- Perfect bot detection on human realms. Enforcement is economic first
  (section 12.6); we do not pretend otherwise.

## 5. Teams, flagging, and identity

### 5.1 Assignment
- First entry per character: assigned to the currently smaller team **among players
  in the zone**, ties broken by the zone Rng. Stored as
  `frontierTeam: 'azure' | 'crimson'` on `CharacterState` (additive JSONB field,
  back-compat default unset).
- Assignment is **permanent per character**. No team swapping: swapping enables
  spying, kill-trading, and vendor double-dipping. A player who wants the other
  color plays another character.
- Party members who enter together are assigned to the same team when balance
  allows (party cohesion beats perfect balance within a tolerance of 2).

### 5.2 Flagging rules
- `isHostileTo(a, b)` gains a Frontier clause: true when both entities are players
  physically inside the Frontier band and `frontierTeam` differs.
- No hostility bleed: teleporting out (the Leave button in the PvP window, or
  death-release rules) ends hostility immediately, since the band check does this
  for free. No overworld flagging in v1.
- Leave is a 10 s channel, interrupted by damage and blocked while in combat:
  entry is a free teleport, but the exit must never be an escape button mid-fight
  (hearthstone-style rules).
- Same-team players are never hostile in the zone (duels disabled inside the
  Frontier to keep the rule simple).
- Pets and companions inherit their owner's team, as they inherit hostility today.

### 5.3 Visible identity
- **The flag on the back**: a banner attachment on the character model, cloth tinted
  team color, visible at gameplay distances. Render-side only, driven by
  `frontierTeam` exposed through the wire entity.
- Nameplates and target frames tint blue/red for enemy players in the zone.
- Team is also shown on the zone map and in the Frontier HUD widget (section 9).

### 5.4 Death and respawn
- Dying to a player or mob in the Frontier: release and respawn at your **team
  base graveyard** (each team has a safe base at opposite ends of the band, with
  guards, the Quartermaster, and the turn-in officer).
- Base perimeters are safe zones: entering the enemy base applies a stacking
  guard threat response (elite guards, level 22, leash to base). No camping the
  spawn.
- Carried cargo drops on death (section 6.3). Equipped gear never drops.

## 6. Resources: harvest, carry, extract

### 6.1 Nodes
A new sim concept: the **resource node**, a stationary interactable entity with
health-like charge, spawned from declarative content records.

- Node types (working set): **Frostvein Ore** (common, everywhere), **Emberbloom**
  (uncommon, cluster spawns), **Ancient Relic Cache** (rare, marked on the zone map
  for both teams when it spawns).
- Harvesting is a **channel** (3 s common, 6 s rare), interrupted by damage or
  movement. Contested by design: you are stationary and visible while gathering.
- Nodes have 1 to 3 charges, deplete on harvest, respawn on a `respawnMult`-style
  timer via the zone Rng at randomized points from a spawn-point pool (same pattern
  as mob camps).
- Node picks, charges, and respawn draws all go through the zone `Rng`; identical
  across hosts.

### 6.2 Carried cargo
- Harvested resources go into a separate **cargo hold**, not the inventory: capacity
  10 units, visible on the character model (saddlebags/backpack bulge scaling with
  load) and as a HUD counter.
- Cargo cannot be traded, mailed, banked, or listed. It exists only in the Frontier.
- Teleporting out of the zone with cargo forfeits it (announced in the Leave
  confirm dialog). The only way to realize value is the turn-in officer at your base.

### 6.3 Dropping and looting
- On death, the victim's entire cargo drops as a lootable satchel for 60 s,
  lootable **by the opposing team only** (prevents kill-trading with a same-team
  friend to launder cargo).
- The satchel is a world entity; anyone on the killing team can grab it (fastest
  finger, encourages the killer's group to hold the field).

### 6.4 Turn-in
- The turn-in officer converts cargo: base rate 2 honor per common unit, 5 per
  uncommon, 25 per relic, plus a copper stipend. Rates are content data, not code.
- Turn-ins also feed the hourly **team score** (section 8.4).

## 7. Honor Points

### 7.1 Earning
| Source | Honor | Notes |
|---|---|---|
| Enemy player kill (killing blow's group, split) | 20 base | Scaled by victim level: full at equal level, 0 for victims 5+ levels below the killer |
| Same-victim diminishing returns | 100% / 50% / 25% / 0 | Per killer-victim pair, resets hourly; kills at 0 still count for events but pay nothing |
| Assist (damaged victim within 10 s) | 5 | Flat, same DR schedule |
| Resource turn-in | 2 / 5 / 25 per unit | Section 6.4 |
| Rare spawn kill (participation) | 15 | Personal-loot style eligibility, reuses the world boss contributor logic |
| Frontier world boss (participation) | 100 | Once per boss per day, same `worldBossDaily` gate pattern |
| Hourly event participation / win | 10 to 50 | Per event definition, section 8 |

- Honor is a plain counter on `CharacterState` (`honor: number`), granted
  server-side in the sim exactly like `delveMarks`. Additive JSONB field.
- **Honor is soulbound, permanently** (section 12.3): no trading, no mailing, no
  bridge to $WOC in any mode. It is the identity asset, and keeping it illiquid
  is what keeps kill DR a balance knob instead of wash-trading security.
- Anti-farm: level-difference gating and per-pair DR above; no honor from kills
  where killer and victim share a party (defense in depth; cross-team parties
  cannot exist anyway); server-side, the existing moderation surface can review
  top honor earners (out of sim scope).

### 7.2 Honor Quartermaster (one per team base, mirrored stock)
- **Gear**: a level-20 PvP set per armor class, priced 150 to 800 honor per slot.
  Stat-budgeted exactly like PvE epics (the `tests/item_level` budget gate applies:
  compute `expectedStatBudget` first). Flavor lean: stamina-heavy relative to PvE
  counterparts, slightly below raid drops so raiding stays aspirational (same
  positioning rule as Badges of Valor).
- **Consumables**: battle standards (short AoE team buff), bandage-style heal item
  usable in the Frontier, a cargo-capacity +5 satchel (1 hour duration).
- **Cosmetics**: team tabard and cloak skins (Azure/Crimson), title unlocks at
  lifetime honor milestones (mirrors the lifetimeXp prestige pattern), a
  `lifetimeHonor` counter backs these.
- Vendor mechanics reuse `NpcDef.vendorItems` + `sim.buyItem` with a price
  currency field extension (`priceHonor` alongside copper prices).

## 8. Hourly events

### 8.1 Framework
- A Frontier **event scheduler** in the sim, generalizing the `worldBossNextAt`
  pattern: every 3600 sim-seconds, draw the next event from a weighted rotation via
  the zone `Rng` (no repeat of the previous event; some events, like the world
  boss, are on fixed rotation slots instead of random draw).
- Hourly means **sim-time hours**, keeping headless/offline determinism. On the
  live server sim-time tracks wall clock closely, so players get a predictable
  "top of the hour" rhythm.
- 5 minutes before an event: zone-wide announcement (stable event key + values,
  re-localized client-side via `sim_i18n.ts`, never English from the sim). The HUD
  shows a countdown.
- Events last 10 to 15 minutes, then the zone returns to baseline.

### 8.2 v1 event rotation (ship these six)
1. **Resource Rush**: all nodes respawn instantly, double charges, double yield.
   The whole zone converges on the node fields.
2. **Bloodmoon**: player kills award double honor, and every player is pinged on
   the zone map every 10 s. Nowhere to hide.
3. **The Caravan**: a neutral NPC caravan crosses the zone on a fixed route.
   Damage-contribution decides which team it pays out to when it reaches the
   center; it drops a cargo pile if destroyed. Escort or ambush.
4. **Relic Surge**: 5 Ancient Relic Caches spawn at once, all marked on the map.
5. **Rare Hunt**: three named rare elites (Frontier-exclusive loot roll groups)
   spawn at announced landmarks.
6. **Warlord of the Frontier** (fixed slot, every 6th hour): the Frontier world
   boss spawns at the central ruin. Both teams want the personal loot and the 100
   honor; neither can safely ignore the other while fighting it.

### 8.3 Event backlog (brainstorm, post-v1 candidates)
- **King of the Hill**: capture-and-hold the central tower; the holding team gets
  a zone-wide +10% honor aura while they hold it (first zone-wide team aura;
  needs a small aura-broadcast mechanism).
- **Supply Drop**: one high-value chest at a random marked point, opened by a long
  contested channel (reuse the delve lockpick minigame as the opener).
- **Bounty Hour**: the top honor earner on each team is marked with a bounty;
  killing them pays 100 honor and clears the mark.
- **Fog of War**: heavy weather rolls in, nameplate/render draw distance halved,
  stealth detection reduced (render-side fog cue, sim-side detection change).
- **Sudden Death**: respawn timers triple for the duration; every kill matters.
- **Free-for-all Ring**: a marked subzone where team hostility is suspended and
  replaced by everyone-hostile; solo bragging rights, honor per kill, no DR.
- **The Vault Opens**: the hourly team score winner (8.4) gets 10 minutes of
  access to a vault room with a loot boss, guarded from the losing team by a
  gate only the winners can pass. The closest v1-adjacent nod to Wintergrasp's
  Vault of Archavon.
- **Gold Vein**: one super-node with 20 charges and a 10 s channel per harvest.
- **Payload Push**: tug-of-war escort, the caravan reversed: each team pushes a
  siege engine toward the enemy base; first to arrive drops the enemy base
  guards for 5 minutes.
- **Night of the Dead** (seasonal): PvE wave defense on both bases
  simultaneously; teams may truce or exploit each other's distraction.
- **Full fortress siege**: walls, gates, siege engines, attacker/defender role
  swap. The real Wintergrasp. Large; its own PRD if the zone proves out.

### 8.4 Team score
Each hour accumulates a per-team score (kills 1 pt, turn-ins 1 pt/unit, event
objectives per event definition). At the hour boundary the winning team's members
in the zone get a 25 honor payout and a 10-minute cosmetic banner buff. Score
feeds future events (The Vault Opens) and gives the hour a narrative arc even
between events.

## 9. Player-facing surfaces (IWorld first)

Extend `IWorld` (`src/world_api.ts`) before touching either world, implement in
both `Sim` and `ClientWorld`:
- `frontierState()`: my team, honor, cargo load, active/next event + countdown,
  team scores.
- Wire entity additions: `frontierTeam` on players, node/satchel/caravan entity
  kinds, cargo-load visual scalar.
- Commands: `frontier_enter`, `frontier_leave`, `gather_node`, `loot_satchel`,
  `turn_in_cargo` (dispatched in `server/game.ts` like `enter_dungeon`).

HUD (each its own module the HUD composes, not new `hud.ts` banner sections):
- PvP window (`G`): the existing Arena window gains a Frostreach Frontier section
  with Enter/Leave, team, honor balance, and next-event countdown alongside the
  Ashen Coliseum queue. Keybind label updates from "Arena (Ashen Coliseum)" to a
  PvP label (i18n key change, completeness gate applies).
- Frontier widget (in-zone): team, honor, cargo 0-10, event countdown, team scores.
- Zone map layer: bases, node fields, event markers, Bloodmoon pings.
- Vendor window reuse with honor prices; FCT shows honor gains like XP.

## 10. Invariant compliance checklist

- **Determinism**: all node spawns, event draws, team tiebreaks via the zone
  `Rng`; hourly timers on sim-time; daily gates via `ctx.utcDay`. No wall-clock.
- **Sim purity**: everything above the render line lives in `src/sim/`
  (new `src/sim/frontier/` directory with an `index.ts` barrel + local CLAUDE.md);
  zero DOM/Three imports; `tests/architecture.test.ts` must stay green.
- **Server authority**: honor grants, cargo, turn-ins, team assignment all resolve
  in the server's sim; the client renders.
- **i18n**: sim/server emit stable keys + values only. Known gates from prior
  work: new item names need translation in all locales
  (`tests/localization_coverage`), event/mechanic names go through the
  `sim_i18n.ts` matcher dictionaries, new HUD chrome keys hit the completeness
  gate (coordinate with the maintainer or stage keys per the release-tier
  workflow), and level-20 vendor gear must hit exact `expectedStatBudget`
  (`tests/item_level`).
- **Content as data**: nodes, events, rares, vendor stock, prices are records in
  `src/sim/content/frontier.ts` merged by `data.ts`; regenerate `/wiki` content
  (`npm run wiki:content`), mind spoiler-safety for rares/boss.
- **Classic fidelity**: honor DR schedules and level-gating mirror classic honor
  rules; no invented balance numbers without a `docs/design/` note.
- **Token firewall**: no wallet, token, or settlement code or imports anywhere in
  `src/sim/` (extend `tests/architecture.test.ts` with this scan). The sim's
  vocabulary ends at cargo, honor, copper.

## 11. Phasing

| Phase | Scope | Acceptance |
|---|---|---|
| 1. Skeleton | Frontier band + G-window enter/leave teleport, team assignment, back banner, auto-flagging, base graveyards, honor counter, honor on kills with DR | Two clients on opposite teams can fight and earn honor; `isHostileTo` tests; parity goldens |
| 2. Economy | Nodes, gather channel, cargo, death drop, turn-in, Honor Quartermaster (gear + consumables) | Full harvest-carry-die-loot-turn-in loop deterministic in a headless test |
| 3. Events | Event scheduler + the six v1 events, team score, HUD countdown | Seeded sim replays the same event sequence; each event has a sim test |
| 4. Apex | Frontier world boss, rare trio, cosmetics/titles, zone map layer, wiki content | Boss daily gate works; i18n gates green at PR tier |
| 5. Wind tunnel | Season config format + headless exploit-agent harness (section 12.7) | Harness runs seeded seasons in CI and reports extraction metrics; kill-trading and node-botting strategies show sub-threshold profit on the candidate config |
| 6. Staked season pilot | One 2-week bracketed season on a dedicated staked shard; deposits/settlement via the wallet boundary; season leaderboard + settlement stories | Season settles correctly end to end on a testnet dry run first; every settlement idempotent and auditable; wind-tunnel gate passed |
| 7. Agent server | Sanctioned-automation realm, agent-entered staked seasons, mixed exhibition events | Agents connect via WS or env API and complete a season; agent entrants marked on leaderboards |

## 12. The $WOC stakes layer

The free Frontier above is a complete feature and ships on its own merits. This
section is what turns the same loop risk-native. Design reference: the
degen-gaming thesis (deposit to play, no skillshots, incomplete information,
continuous risk/reward, adversarial robustness) and Cambria's season cadence.
The pitch in one line: **make money by being good at World of ClaudeCraft.**

### 12.1 Two loops, one design
- **Free loop** (sections 5 to 9): always on, every realm, play stakes. It is the
  on-ramp, the practice arena, and, deliberately, the stake multiplier: the
  level, gear, and talents a character earns in free play determine its
  efficiency in staked play. Time invested in the free game IS part of your
  edge, which stacks the identity moat on top of the financial one.
- **Staked seasons**: scheduled, bounded runs (2 weeks, Cambria's cadence) on
  dedicated staked shards. Entry is a $WOC deposit; extraction settles back to
  $WOC at season end. Bounded seasons before any 24/7 persistent staked world:
  every season is an economic experiment with a settlement date, and a bad
  parameter dies with its season instead of compounding.

### 12.2 The token firewall (invariant, not preference)
$WOC never enters `src/sim/`. The sim speaks cargo units, honor, and copper; the
server boundary maps wallet deposits to season entries and sim outcomes to
settlements, building on the verified wallet identity from
`docs/prd/woc/wallet-link.md` (custody and settlement mechanics get their own
doc in `docs/prd/woc/`). What the firewall buys:
- The three-host guarantee survives: offline and headless run the identical
  season rules with play stakes, which is what makes 12.7 possible at all.
- `tests/architecture.test.ts` stays meaningful and gains the token scan.
- A structural firewall for the regulatory question (12.9): the game is complete
  and playable with zero money attached; the stakes layer is a server-side
  mapping on top.

### 12.3 Honor is soulbound; cargo is the stake
Two assets, two jobs, never crossed:
- **Honor** is identity: titles, vendor unlock rights, lifetime milestones.
  Never tradeable, never bridgeable, in free or staked play. The moment honor is
  liquid, every kill-DR rule becomes wash-trading security instead of game
  balance, and the identity moat (the thing that retains players who are down
  money) is for sale.
- **Cargo** is the stake: in a staked season the deposit converts to season
  entry plus season-scoped gear risk, resources extracted convert back to $WOC
  at settlement, and death drops carried value to the killer exactly as in the
  free loop. Full-loot honesty applies to the carried layer only, never to the
  soulbound layer: you can lose a season, you cannot lose who you are in the
  game.

### 12.4 Rake and sinks
The house edge is the classic MMO sink set, reframed and tunable per season in
the season config (data, not code): the turn-in tax, durability loss on death
(repairs cost season currency), consumables, and the season entry fee. Tuning
principle from the degen thesis, stated as a requirement: **tune for longevity,
not take**. Extraction-heavy economies eat their fish and die (the trenches);
every rake change must pass the wind tunnel (12.7) with fish-survival metrics,
not just house-revenue metrics.

### 12.5 Brackets and new-player protection
- Seasons are **stake-bracketed**: minnow, standard, and shark brackets by
  deposit size, so new depositors fight each other and not season veterans
  running juiced characters.
- Staked play requires level 20 (the free zone is where you get there and learn
  the loop with play stakes first).
- The known tension: brackets invite smurfing (sharks entering minnow brackets
  with fresh wallets). Mitigations are economic (bracket payouts scale with
  bracket size, so farming minnows pays minnow money) plus wallet-age/history
  heuristics at the server boundary; we do not claim this is fully solvable, we
  claim it is tunable, and it is a standing wind-tunnel scenario.

### 12.6 Agents are first-class: the agent server
Posture: **embrace**. This repo ships a headless RL env as a feature; pretending
the game is unbottable would be self-delusion with a settlement date. Instead:
- **The agent server**: a dedicated realm (realm-flag config, e.g.
  `REALM_AGENTS=1`, surfaced in `REALM_DIRECTORY` so humans know exactly where
  they are) where automation is sanctioned. Agents connect through the normal WS
  protocol or the headless env API and play the same authoritative sim. Realms
  already give us the isolation boundary for free.
- **Agent-entered staked seasons** run on the agent server: my agent, my stake,
  my strategy. Leaderboards mark agent entrants and their authors. This is a
  product nobody else has: degen gaming for the agent-builder crowd, and the RL
  env flips from liability (bot vector) to developer surface.
- **Human realms**: staked brackets are human-only by policy. Enforcement is
  economic first (entry stakes make sybil farming a capital cost, DR and
  brackets cap the yield), moderation second, and never claimed perfect
  (non-goal). The honest offer to a caught botter is: your playstyle has a home,
  it is the agent server, take your stake there.
- **Mixed exhibition seasons** (humans and agents in one bracket, clearly
  labeled) as scheduled spectacle events, not the default.

### 12.7 The economy wind tunnel
A deliverable with tests, not an aspiration: a headless harness (`headless/` +
the season config) that runs many seeded seasons with scripted adversarial
agents (kill-traders, node-botters, cargo-launderers, sybil rings, shark pods
hunting minnows) against a candidate season configuration, and reports
extraction rate, honor inflation, new-player survival and retention proxies, and
the concentration of winnings. It runs in CI for any change to season
parameters. This is the structural advantage the deterministic sim buys us:
**Cambria tunes its economy on paying players; we tune ours in CI.** The same
harness doubles as the regression suite for 12.5's smurfing scenarios and
12.4's rake changes.

### 12.8 Spectacle, scarcity, and GTM
- **Relics go scarce**: the Ancient Relic Cache tier (6.1) upgrades in staked
  seasons to limited-count legendary drops (fixed mint per season). This is the
  asymmetric-upside slot: the improbable extraction clip that markets the game.
- **Make winners legible** (the Moneymaker effect): season leaderboards (the
  `K` leaderboard window grows a season tab), a kill/extraction feed, and
  settlement-day stories: biggest extraction, best comeback, top guild, top
  agent author. Emergent PvP drama is free perpetual content; give it surfaces.
- Wintergrasp events double as spectacle scheduling: Warlord hour and Bloodmoon
  are when streams tune in.

### 12.9 Regulatory posture (honest, brief)
Real-money entry plus chance-weighted outcomes is regulated gambling in many
jurisdictions, and the no-skillshots design (correctly, for the game) pushes
outcomes toward dice, which is the wrong direction for a skill-game legal
classification. Jurisdiction strategy, geofencing, and licensing are a business
decision with counsel that gates any staked season going live; they are out of
scope for this PRD. What is in scope: the token firewall (12.2) and the
complete-without-money free loop are the strongest structural mitigations we
can build, so they are invariants regardless of how the legal question
resolves.

## 13. Future hooks (explicitly deferred)
- `REALM_TYPE='PvP'` shard where overworld zones use Frontier flagging.
- Frontier resources as crafting mats when professions land.
- Fortress siege event (own PRD).
- 24/7 persistent staked world (only if bounded seasons prove the economy).
- Spectator mode + betting on agent seasons (prediction-market layer; own PRD,
  own regulatory analysis).
- Cross-realm event calendar alignment.

## 14. Decisions and open questions

Resolved in this revision:
1. Entry level: 15+ for the free zone (DR level-gating protects them), hard 20
   for staked seasons (12.5).
2. Cargo on teleport-out: forfeit, no tax exit. Cleaner rule, stronger
   extraction tension, and in staked play a tax exit would be a volatility
   escape hatch.
3. Stealth openers on mid-channel gatherers: allowed. Getting sapped at a node
   is the point; incomplete information is a feature.
4. Offline worlds: the Frontier exists offline with nodes, rares, and events
   (play stakes, no bot teams in v1); staked seasons are online-only on
   dedicated shards.
5. Agent posture: embrace, via the agent server (12.6).

Still open:
1. Honor cap per day/week, or let DR do the work? (Lean: no cap in the free
   loop, measure; the wind tunnel answers this for staked seasons.)
2. Bracket boundaries and payout curves for the first staked season (a wind
   tunnel output, not a taste call).
3. Season deposit denomination and custody mechanics ($WOC native vs
   stable-denominated entries settled in $WOC; escrow design): the
   `docs/prd/woc/` settlement doc owns this.
4. Does the free Frontier ship to all realms before season 1, or launch
   together? (Lean: free first; it is the funnel and the playtest.)
5. Mixed human/agent exhibition rules: same bracket, or agents handicapped
   (tick-rate budget, action-rate caps)?

## 15. Variant: the FFA frozen island (no teams, pacts, betrayal)

A sibling zone to the two-team Frontier above, added here rather than as its
own PRD because it reuses every rail in sections 6 to 12 and only changes the
social model. Frostreach is a *war*: two banners, a front line, base
graveyards, a team score. The island is a *gold rush*: a newly discovered
frozen island, dense with resources, no sides. Everyone is hostile by default,
alliances are temporary and breakable, and the player who helped you clear a
relic cache is the one who saps you at the evac beacon. Different fantasy,
different math, same cargo/honor/$WOC plumbing. Ships as its own season format;
when this section is silent, the rest of the PRD governs.

### 15.1 What carries over unchanged
Gear is account-bound and never drops; cargo is the only stake (5.4, 6). The
token firewall (12.2), soulbound honor vs staked cargo (12.3), stake brackets
and the level-20 gate (12.5), the agent server (12.6), the economy wind tunnel
(12.7), and the regulatory posture (12.9) all apply as written. The island is
a different arrangement of the same parts, not a different economy.

### 15.2 Flagging becomes default-hostile
There is no `frontierTeam` on the island. The Frontier hostility clause (5.2)
is replaced by: two players in the zone are hostile unless they are in an
active **pact**. The default relationship between any two players is enemy.
Entry, the 10 s interruptible Leave channel, and no-hostility-bleed on exit
carry over from 5.2. Pets and companions inherit their owner's pacts.

### 15.3 Pacts: alliances you can break at any instant
- A pact is a temporary, mutual, non-hostility agreement between players (cap a
  pact group at around 5 so the island never collapses into one blob and the
  FFA tension survives). Propose, accept, and you stop being hostile to each
  other.
- **Betrayal is a first-class move and it is instant.** Any member drops a pact
  at any time, no channel and no cooldown, and is immediately hostile again.
  The double-cross at the beacon is supposed to work. Open taste call: whether
  the victim gets a tell (a brief on-screen flash the instant a pact drops, or
  a sub-second draw animation on the betrayer), so that cooperation is
  *possible* without being *safe*. We do not want a long betrayal cast that
  removes the move.
- Pacts are zone-only, drop on death or leave, and grant no shared reward
  split beyond "we are not currently hostile."

### 15.4 No team bases; extract to neutral beacons
No Azure/Crimson graveyards. Death releases you to a rotating set of shoreline
spawn points, never a fortified home base, so there is no safe turtle corner.
Value is realized at **neutral extraction beacons** inland: reach one alive
with cargo and channel to bank your haul toward the ladder. Beacons are the
natural ambush and betrayal point, contested by design. Teleport-out still
forfeits cargo (decision 2).

### 15.5 Ganging up and betrayal are intended; wash-trading is staked-only
Two behaviors get called "collusion" and they get opposite treatment.

- **Ganging up, temporary alliances, and betrayal are the point.** Three
  players team to drop a juiced solo and then knife each other over the satchel
  at the beacon: that is the free content engine (12.8). It is fully allowed on
  every tier and needs no special machinery. Greed self-polices it, because
  allies have *opposing* interests over who actually walks out with the haul.
- **Wash-trading is the only genuinely adversarial case, and it is different in
  kind.** Two wallets cooperatively alternate kills to funnel value to one
  predetermined winner (one person on two accounts, or a farmer feeding a
  main). Betrayal does *not* police this, because the parties are not fighting
  over the loot, they are cooperating to move it, so neither ever defects. It
  looks like PvP but there is no contest.

The relief valve: wash-trading only matters when real $WOC is on the line. In
the free / play-stakes island there is nothing to launder, so it is just
gameplay. Therefore:

- The free FFA island ships with **zero anti-collusion machinery**. There is no
  opposing-team loot gate to inherit (6.3 assumes teams that do not exist
  here), no pact-based loot restrictions, no heuristics. Gang up, betray, feed
  a friend: all allowed, all content.
- Wash-trade defense is a **staked-season-only knob deferred to the wind
  tunnel** (12.7), sitting next to the smurfing scenario (12.5), never in the
  free loop. We pick no loot rule now. Candidate levers, recorded for that
  later analysis and not adopted here: score-only cargo transfer (the killer
  banks the victim's cargo *value*, but cannot hand specific units to a third
  party) and wallet-age/history clustering on repeated A-kills-B-then-B-kills-A
  pairs.

### 15.6 The one open design problem: the shark and the fish
Crits give per-hit variance but gear gap decides fights, so an open-loot island
is more deterministic than a slot machine: the juiced player farms the fish and
the fish leaves (the extraction death spiral the thesis warns about). Deposit
brackets (12.5) answer this for *staked* play, but the *free / play-stakes* loop
has no brackets to sort by, so the funnel can eat its own new players.
Candidate: an optional gear-normalized ("tournament ruleset") island tier
alongside a full-power tier, so a fresh level-20 has a lane where nerve beats
gear score. Open question; measure new-player survival in the wind tunnel before
committing.

### 15.7 Agent-native, same as the war zone
Agents are first-class here too (12.6): default-hostile FFA with breakable pacts
is fully agent-completable (stat and dice checks, positioning, and risk
judgment, never twitch skillshots), and the betrayal tell must not become a
reflex test. A stakes island where the machine is a welcome main character is
the one thing a bot-hostile competitor structurally cannot ship.

### 15.8 Player-facing surfaces (delta from section 9)
The Frontier HUD widget gains: active pact members and their state, pact
propose/accept/break controls, default-hostile nameplates (everyone red unless
pacted), and a kill/betrayal feed for the spectacle layer (12.8). New strings
are English-only in the implementing PR; the maintainer fills locales at
release. IWorld-first as in section 9.

### 15.9 Open questions specific to the island
1. The betrayal tell: instant with a victim flash, a sub-second draw tell, or
   nothing? (Decides whether cooperation is ever worth attempting.)
2. Pact group size cap, and whether pact groups can pact with each other
   (coalitions) or only individuals.
3. Free-loop shark/fish: ship a gear-normalized island tier, or lean on the
   level-20 gate and let the wind tunnel measure survival first?
4. Island name and cargo item names (new IP only; no WoW-derived naming).
