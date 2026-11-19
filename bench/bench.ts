/**
 * Headless benchmarks: physics step cost vs body count, ECS query cost.
 *   node bench/bench.ts
 */
import { PhysicsWorld } from "../src/physics.ts";
import { World } from "../src/ecs.ts";
import { rng } from "../src/math.ts";

function physics(n: number) {
  const w = new PhysicsWorld();
  w.add({ pos: [0, -0.5, 0], shape: { kind: "box", half: [80, 0.5, 80] } });
  const r = rng(1);
  const side = Math.ceil(Math.sqrt(n / 4));
  for (let i = 0; i < n; i++) {
    const x = (i % side) * 1.6 - side * 0.8, z = (Math.floor(i / side) % side) * 1.6 - side * 0.8, y = 1 + Math.floor(i / (side * side)) * 1.6;
    w.add({ pos: [x + r() * 0.2, y, z + r() * 0.2], shape: r() < 0.5 ? { kind: "sphere", r: 0.5 } : { kind: "box", half: [0.5, 0.5, 0.5] }, mass: 1 });
  }
  // 2 s of falling and colliding (awake), then 3 s more to measure the settled state
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  const active = (performance.now() - t0) / 120;
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  const t1 = performance.now();
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  const settled = (performance.now() - t1) / 60;
  return { n, active, settled, sleeping: w.stats.sleeping };
}

console.log("physics step (ms), 60 Hz budget is 16.7 ms");
console.log("bodies   active   settled   asleep");
for (const n of [100, 250, 500, 1000, 2000]) {
  const r = physics(n);
  console.log(`${String(r.n).padStart(6)}  ${r.active.toFixed(2).padStart(7)}  ${r.settled.toFixed(2).padStart(8)}  ${String(r.sleeping).padStart(7)}`);
}

const w = new World();
const pos = w.store<number[]>("pos"), vel = w.store<number[]>("vel");
for (let i = 0; i < 100000; i++) {
  const e = w.spawn();
  pos.set(e, [0, 0, 0]);
  if (i % 2 === 0) vel.set(e, [1, 1, 1]);
}
const t = performance.now();
let k = 0;
for (let rep = 0; rep < 20; rep++)
  for (const e of w.query("pos", "vel")) { const p = pos.get(e)!, v = vel.get(e)!; p[0] += v[0]; k++; }
console.log(`\necs: query pos+vel over 100k entities (50k match): ${((performance.now() - t) / 20).toFixed(2)} ms per pass (${k / 20} hits)`);
