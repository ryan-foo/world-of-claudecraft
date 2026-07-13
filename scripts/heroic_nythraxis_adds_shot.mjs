// Visual proof of the three heroic Nythraxis adds and their models. Boots the
// offline game and stages each add close to the camera so its model is clear:
// Aldren the warrior (skel_warrior), Malric the priest (skel_necromancer, with
// his heal-channel beam onto a wounded boss), and Voss the stalker (skel_rogue).
//   PORT=5174 node scripts/heroic_nythraxis_adds_shot.mjs   (needs npm run dev)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const PORT = process.env.PORT ?? '5174';
const URL = process.env.GAME_URL ?? `http://localhost:${PORT}`;
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 40000 });
const jsClick = (s) => page.evaluate((x) => document.querySelector(x)?.click(), s);
await new Promise((r) => setTimeout(r, 500));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Scout');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 45000 });
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 350));
}
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Stage one add (plus, for Malric, a wounded boss to receive the heal beam) a
// short distance in front of the camera, and target it so its frame shows.
async function stageAndShot(tid, file, withBoss) {
  const ok = await page.evaluate(
    ({ tid, withBoss }) => {
      const sim = window.__game.sim;
      const ctx = sim.ctx;
      const p = sim.player;
      // clear any previously staged mobs (the wounded boss included)
      for (const e of [...ctx.entities.values()]) {
        if (
          e.kind === 'mob' &&
          (String(e.templateId).startsWith('nythraxis_heroic_') ||
            e.templateId === 'nythraxis_scourge_of_thornpeak')
        ) {
          ctx.entities.delete(e.id);
        }
      }
      const base = [...ctx.entities.values()].find((e) => e.kind === 'mob');
      if (!base) return false;
      // Open grassland north of the starting town, the same stage the showcase
      // shots use: no NPC nameplates or buildings in frame, player looking
      // straight down +z at the posed add.
      const g = sim.groundPos(60, 40);
      p.pos = { x: g.x, y: g.y, z: g.z };
      p.prevPos = { ...p.pos };
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.facing = 0;
      p.inCombat = false;
      p.hp = p.maxHp;
      // Clear wandering field mobs near the stage so only the add is in frame.
      const baseKeep = [...ctx.entities.values()].find((e) => e.kind === 'mob');
      for (const e of [...ctx.entities.values()]) {
        if (e.kind !== 'mob' || e === baseKeep) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < 70) ctx.entities.delete(e.id);
      }
      const fx = 0;
      const fz = 1;
      const spawn = (templateId, dx, dz, scale, hp) => {
        const m = structuredClone(base);
        m.id = ctx.nextId++;
        m.templateId = templateId;
        m.name =
          {
            nythraxis_heroic_warrior_add: 'Spirit of Aldren',
            nythraxis_heroic_priest_add: 'Spirit of Malric',
            nythraxis_heroic_rogue_add: 'Spirit of Voss',
            nythraxis_scourge_of_thornpeak: 'Nythraxis, Scourge of Thornpeak',
          }[templateId] ?? templateId;
        m.scale = scale;
        m.level = 22;
        m.maxHp = hp;
        m.hp = hp;
        m.dead = false;
        m.hostile = true;
        m.auras = [];
        m.nythraxis = undefined;
        m.summonedIds = [];
        m.threat = new Map();
        const bx = p.pos.x + fx * 11 + dx;
        const bz = p.pos.z + fz * 11 + dz;
        const mg = sim.groundPos(bx, bz);
        m.pos = { x: bx, y: mg.y, z: bz };
        m.prevPos = { ...m.pos };
        m.spawnPos = { ...m.pos };
        m.facing = Math.atan2(p.pos.x - bx, p.pos.z - bz);
        m.prevFacing = m.facing;
        ctx.addEntity(m);
        return m.id;
      };
      // Real heroic-raid numbers (nythraxis_boss_arena tuning: level 22, health
      // x1.6, on the 2.3x elite factor) and the real template scales, so the
      // targeted frame reads the live fight's health pools.
      const REAL = {
        nythraxis_heroic_warrior_add: { hp: 2716, scale: 1.25 },
        nythraxis_heroic_priest_add: { hp: 1376, scale: 1.18 },
        nythraxis_heroic_rogue_add: { hp: 1568, scale: 1.12 },
      };
      const real = REAL[tid];
      const addId = spawn(tid, 0, 0, real.scale, real.hp);
      if (withBoss) {
        const bossId = spawn('nythraxis_scourge_of_thornpeak', -10, 12, 3.1, 96000);
        const boss = ctx.entities.get(bossId);
        if (boss) boss.hp = Math.floor(boss.maxHp * 0.4); // wounded, so Malric heals it
      }
      p.targetId = addId;
      if (sim.setTarget) {
        try {
          sim.setTarget(p.id, addId);
        } catch {}
      }
      return true;
    },
    { tid, withBoss },
  );
  if (!ok) {
    console.log('stage failed for', tid);
    return;
  }
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log('shot', file);
}

await stageAndShot('nythraxis_heroic_warrior_add', 'heroic_add_aldren_warrior.png', false);
await stageAndShot('nythraxis_heroic_priest_add', 'heroic_add_malric_priest.png', true);
await stageAndShot('nythraxis_heroic_rogue_add', 'heroic_add_voss_stalker.png', false);

await browser.close();
console.log('done');
