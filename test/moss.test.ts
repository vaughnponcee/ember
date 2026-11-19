import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMap, entities, stepPlayer, TILE, JUMP, GRAV, type Mover, type Controls } from "../web/moss.ts";

const DT = 1 / 60;
// prove reachability with a jump 5% weaker than the real one: every ledge has margin
const WEAK_JUMP = JUMP * 0.95;
const map = buildMap(), ents = entities();
const spike = (x: number, y: number) => map.get(Math.floor(x / TILE), Math.floor(y / TILE)) === 5;

/**
 * Explore the level the way a player can: from every place you can stand, try
 * walking/running each way with no jump, a short hop or a full jump, and dropping
 * through planks. Landings become new places to stand. Spikes and pits end a path.
 */
function explore() {
  const coinHit = new Set<number>();
  let goal = false;
  const seen = new Set<string>();
  const queue: Mover[] = [];
  const fresh = (x: number, y: number): Mover => ({ b: { x, y, w: 10, h: 14 }, vx: 0, vy: 0, face: 1, grounded: false, coyote: 0, buffer: 0 });

  // settle the spawn
  const s = fresh(ents.spawn.x, ents.spawn.y);
  for (let i = 0; i < 120 && !s.grounded; i++) stepPlayer(s, { x: 0, run: false, jumpPressed: false, jumpHeld: false, drop: false }, map, DT);
  queue.push(s);

  const touch = (m: Mover) => {
    ents.coins.forEach((c, i) => { if (Math.abs(m.b.x + 5 - c.x) < 10 && Math.abs(m.b.y + 7 - c.y) < 11) coinHit.add(i); });
    if (Math.abs(m.b.x - ents.goal.x) < 14 && Math.abs(m.b.y - ents.goal.y) < 24) goal = true;
  };
  const key = (m: Mover) => `${Math.round(m.b.x / 4)},${Math.round(m.b.y)}`;

  while (queue.length) {
    const start = queue.shift()!;
    for (const dir of [-1, 0, 1])
      for (const run of [false, true])
        for (const jump of [0, 8, 40, -1]) { // -1: drop through
          for (const runUp of jump > 0 && dir !== 0 ? [0, 14] : [0]) {
            const m: Mover = { ...start, b: { ...start.b }, vx: 0, vy: 0, grounded: true, coyote: 0.1, buffer: 0 };
            let left = false, dead = false;
            for (let f = 0; f < 200; f++) {
              const jf = f - runUp;
              const c: Controls = { x: dir, run, jumpPressed: jump > 0 && jf === 0, jumpHeld: jump > 0 && jf >= 0 && jf < jump, drop: jump === -1 && f < 6 };
              stepPlayer(m, c, map, DT, WEAK_JUMP);
              touch(m);
              if (spike(m.b.x + 2, m.b.y + m.b.h) || spike(m.b.x + m.b.w - 2, m.b.y + m.b.h) || m.b.y > map.h * TILE) { dead = true; break; }
              if (!m.grounded) left = true;
              // walking stops after a short stroll; jumps run until they land
              if ((left && m.grounded) || (!left && jump === 0 && f >= 20)) break;
            }
            if (dead || !m.grounded) continue;
            const k = key(m);
            if (!seen.has(k)) { seen.add(k); queue.push(m); }
          }
        }
  }
  return { coinHit, goal, states: seen.size };
}

test("full jump clears a 3-tile ledge with margin", () => {
  const peak = (JUMP * JUMP) / (2 * GRAV), weak = (WEAK_JUMP * WEAK_JUMP) / (2 * GRAV);
  assert.ok(peak > 3.6 * TILE && peak < 4 * TILE, `peak ${peak}px`);
  assert.ok(weak > 3.2 * TILE, `weak jump peak ${weak}px`);
});

test("every coin and the goal flag can actually be reached", () => {
  const r = explore();
  const missing = ents.coins.map((c, i) => [i, c] as const).filter(([i]) => !r.coinHit.has(i)).map(([, c]) => `(${c.x / TILE - 0.5}, ${c.y / TILE - 0.5})`);
  assert.deepEqual(missing, [], `unreachable coins at tile ${missing.join(" ")}`);
  assert.ok(r.goal, "goal flag unreachable");
  assert.ok(r.states > 50, `explored ${r.states} standing spots`);
});
