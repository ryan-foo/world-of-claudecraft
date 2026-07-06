// Behavioral coverage gate for Talents 2.0 content. `choice_rows.test.ts` proves every
// option's effect RESOLVES and every granted ability is GRANTED; this proves the stronger
// claim that each granted ACTIVE actually DOES something in combat. It allocates every
// granted row option and every spec signature, casts the granted ability at a pinned
// dummy with generous resources, and fails on any that produce no observable effect
// (no damage/heal, no aura on self or target, no cooldown set, no resource spent) - i.e.
// a granted-but-broken ability (uncastable, no-op, wrong resource). It does NOT check the
// effect is numerically correct; that is the tooltip-accuracy + parity + playtest layer.
import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const CLASSES = Object.keys(CHOICE_ROWS) as PlayerClass[];
const SEED = 4242;

type Case = { label: string; cls: PlayerClass; grant: string; allocate: (sim: Sim) => boolean };

function grantCases(): Case[] {
  const out: Case[] = [];
  for (const cls of CLASSES) {
    for (const row of CHOICE_ROWS[cls].rows) {
      for (const opt of row.options) {
        const g = opt.effect.grant?.ability;
        if (!g) continue;
        out.push({
          label: `${cls}:r${row.level}:${opt.id} -> ${g}`,
          cls,
          grant: g,
          allocate: (sim) => sim.chooseRow(row.level, opt.id),
        });
      }
    }
    for (const spec of TALENTS[cls]?.specs ?? []) {
      if (!spec.signature) continue;
      out.push({
        label: `${cls}:spec:${spec.id} -> ${spec.signature}`,
        cls,
        grant: spec.signature,
        allocate: (sim) => sim.setSpec(spec.id),
      });
    }
  }
  return out;
}

function producesEffect(c: Case): string {
  const sim = new Sim({ seed: SEED, playerClass: c.cls, autoEquip: true });
  sim.setPlayerLevel(20);
  const pid = sim.playerId;
  const p = sim.entities.get(pid)!;
  if (!c.allocate(sim)) return 'allocation failed';
  if (!sim.resolvedAbility(c.grant)) return 'granted ability not known after allocation';

  // Generous setup so a rejected cast is a real dud, not a missing prerequisite.
  p.maxHp = p.hp = 1_000_000;
  p.resource = p.maxResource;
  (p as unknown as { comboPoints: number }).comboPoints = 5;
  const mob = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.ridge_stalker, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 6,
  });
  mob.maxHp = mob.hp = 1_000_000;
  mob.hostile = true;
  sim.entities.set(mob.id, mob);
  (sim as unknown as { rebucket: (e: unknown) => void }).rebucket(mob);
  p.facing = 0;
  sim.targetEntity(mob.id, pid);

  const before = {
    hp: mob.hp,
    pAuras: p.auras.length,
    mAuras: mob.auras.length,
    cds: p.cooldowns.size,
    res: p.resource,
  };
  let dmgHeal = false;
  for (let i = 0; i < 20 * 4; i++) {
    mob.hp = 1_000_000;
    mob.aggroTargetId = null;
    p.hp = p.maxHp;
    if (i === 0) sim.castAbility(c.grant, pid, { x: mob.pos.x, z: mob.pos.z });
    for (const e of sim.tick())
      if ((e.type === 'damage' || e.type === 'heal') && (e as { sourceId?: number }).sourceId === pid)
        dmgHeal = true;
  }
  const fired =
    dmgHeal ||
    mob.hp < before.hp ||
    p.auras.length > before.pAuras ||
    mob.auras.length > before.mAuras ||
    p.cooldowns.size > before.cds ||
    p.resource < before.res;
  return fired ? '' : 'cast produced no observable effect';
}

describe('Talents 2.0 grant coverage', () => {
  it('every granted row ability and spec signature produces an observable effect when cast', () => {
    const duds: string[] = [];
    for (const c of grantCases()) {
      const why = producesEffect(c);
      if (why) duds.push(`${c.label}  (${why})`);
    }
    expect(duds, `granted abilities that did nothing:\n${duds.join('\n')}`).toEqual([]);
  });
});
