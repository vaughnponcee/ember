import { test } from "node:test";
import assert from "node:assert/strict";
import { PhysicsWorld, collide, rayBody } from "../src/physics.ts";
import { rng } from "../src/math.ts";

const floor = (w: PhysicsWorld) => w.add({ pos: [0, -0.5, 0], shape: { kind: "box", half: [50, 0.5, 50] } });

test("sphere falls, lands on the floor and comes to rest", () => {
  const w = new PhysicsWorld();
  floor(w);
  const b = w.add({ pos: [0, 5, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1 });
  for (let i = 0; i < 240; i++) w.step(1 / 60);
  assert.ok(Math.abs(b.pos[1] - 0.5) < 0.02, `y=${b.pos[1]}`);
  assert.ok(b.grounded || b.sleeping);
  assert.ok(Math.hypot(...b.vel) < 0.1);
});

test("free fall matches v = g t", () => {
  const w = new PhysicsWorld();
  const b = w.add({ pos: [0, 100, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1 });
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  assert.ok(Math.abs(b.vel[1] - w.gravity[1]) < 1e-6);
});

test("box stack of 5 stays standing and goes to sleep", () => {
  const w = new PhysicsWorld();
  floor(w);
  const boxes = [0, 1, 2, 3, 4].map((i) => w.add({ pos: [0, 0.5 + i * 1.001, 0], shape: { kind: "box", half: [0.5, 0.5, 0.5] }, mass: 1 }));
  for (let i = 0; i < 300; i++) w.step(1 / 60);
  boxes.forEach((b, i) => {
    assert.ok(Math.abs(b.pos[1] - (0.5 + i)) < 0.05, `box ${i} y=${b.pos[1]}`);
    assert.ok(Math.abs(b.pos[0]) < 1e-6 && Math.abs(b.pos[2]) < 1e-6);
  });
  assert.equal(w.stats.sleeping, 5);
});

test("elastic head-on collision of equal masses swaps velocities", () => {
  const w = new PhysicsWorld();
  w.gravity = [0, 0, 0];
  const a = w.add({ pos: [-2, 0, 0], vel: [5, 0, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1, restitution: 1 });
  const b = w.add({ pos: [2, 0, 0], vel: [-5, 0, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1, restitution: 1 });
  for (let i = 0; i < 60; i++) w.step(1 / 120);
  assert.ok(Math.abs(a.vel[0] + 5) < 1e-6 && Math.abs(b.vel[0] - 5) < 1e-6, `${a.vel[0]} ${b.vel[0]}`);
});

test("momentum is conserved in an inelastic collision", () => {
  const w = new PhysicsWorld();
  w.gravity = [0, 0, 0];
  const a = w.add({ pos: [-2, 0, 0], vel: [6, 0, 0], shape: { kind: "sphere", r: 0.5 }, mass: 3, restitution: 0 });
  const b = w.add({ pos: [2, 0.2, 0], vel: [-1, 0, 0], shape: { kind: "box", half: [0.5, 0.5, 0.5] }, mass: 1, restitution: 0 });
  const p0 = 3 * 6 + 1 * -1;
  for (let i = 0; i < 120; i++) w.step(1 / 120);
  const p1 = 3 * a.vel[0] + 1 * b.vel[0];
  assert.ok(Math.abs(p1 - p0) < 1e-6, `${p0} vs ${p1}`);
});

test("friction stops a sliding box; ice keeps it sliding", () => {
  const run = (mu: number) => {
    const w = new PhysicsWorld();
    w.add({ pos: [0, -0.5, 0], shape: { kind: "box", half: [200, 0.5, 200] }, friction: mu });
    const b = w.add({ pos: [0, 0.5, 0], vel: [8, 0, 0], shape: { kind: "box", half: [0.5, 0.5, 0.5] }, mass: 1, friction: mu });
    for (let i = 0; i < 180; i++) w.step(1 / 60);
    return b;
  };
  assert.ok(Math.abs(run(0.8).vel[0]) < 0.05);
  assert.ok(run(0).vel[0] > 7.9);
});

test("fuzz: 300 random bodies never end up inside the floor or each other by much", () => {
  const w = new PhysicsWorld();
  floor(w);
  const r = rng(3);
  const bodies = Array.from({ length: 300 }, () =>
    w.add({
      pos: [r() * 20 - 10, 1 + r() * 30, r() * 20 - 10],
      shape: r() < 0.5 ? { kind: "sphere", r: 0.3 + r() * 0.4 } : { kind: "box", half: [0.3 + r() * 0.3, 0.3 + r() * 0.3, 0.3 + r() * 0.3] },
      mass: 0.5 + r() * 2,
    }));
  for (let i = 0; i < 600; i++) w.step(1 / 60);
  let worst = 0;
  for (const b of bodies) {
    const bottom = b.pos[1] - (b.shape.kind === "sphere" ? b.shape.r : b.shape.half[1]);
    worst = Math.max(worst, -bottom);
    for (const x of b.pos) assert.ok(Number.isFinite(x));
  }
  assert.ok(worst < 0.08, `deepest floor penetration ${worst}`);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const c = collide(bodies[i], bodies[j]);
      if (c) assert.ok(c.depth < 0.15, `pair overlap ${c.depth}`);
    }
});

test("broadphase finds the same colliding pairs as brute force", () => {
  const w = new PhysicsWorld();
  const r = rng(11);
  for (let i = 0; i < 400; i++)
    w.add({ pos: [r() * 30, r() * 30, r() * 30], shape: r() < 0.5 ? { kind: "sphere", r: 0.5 + r() } : { kind: "box", half: [0.5 + r(), 0.5, 0.5 + r()] }, mass: 1 });
  const key = (a: number, b: number) => Math.min(a, b) + ":" + Math.max(a, b);
  const fromGrid = new Set(w.broadphase().filter(([a, b]) => collide(a, b)).map(([a, b]) => key(a.id, b.id)));
  const brute = new Set<string>();
  for (let i = 0; i < w.bodies.length; i++)
    for (let j = i + 1; j < w.bodies.length; j++)
      if (collide(w.bodies[i], w.bodies[j])) brute.add(key(w.bodies[i].id, w.bodies[j].id));
  assert.ok(brute.size > 20);
  assert.deepEqual([...fromGrid].sort(), [...brute].sort());
});

test("triggers report overlaps but do not push", () => {
  const w = new PhysicsWorld();
  w.gravity = [0, 0, 0];
  const t = w.add({ pos: [0, 0, 0], shape: { kind: "sphere", r: 1 }, trigger: true });
  const b = w.add({ pos: [0.5, 0, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1 });
  w.step(1 / 60);
  assert.equal(w.triggerEvents.length, 1);
  assert.ok(w.triggerEvents[0].a === t || w.triggerEvents[0].b === t);
  assert.equal(b.pos[0], 0.5);
});

test("layer masks filter collisions", () => {
  const w = new PhysicsWorld();
  w.gravity = [0, 0, 0];
  w.add({ pos: [0, 0, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1, layer: 2, mask: 2 });
  const b = w.add({ pos: [0.5, 0, 0], shape: { kind: "sphere", r: 0.5 }, mass: 1, layer: 4, mask: 4 });
  w.step(1 / 60);
  assert.equal(b.pos[0], 0.5);
});

test("raycasts hit spheres and boxes at the right distance and normal", () => {
  const w = new PhysicsWorld();
  w.add({ pos: [0, 0, -10], shape: { kind: "sphere", r: 2 } });
  w.add({ pos: [0, 0, -5], shape: { kind: "box", half: [1, 1, 1] } });
  const h = w.raycast([0, 0, 0], [0, 0, -1])!;
  assert.ok(Math.abs(h.t - 4) < 1e-9);
  assert.deepEqual(h.normal, [0, 0, 1]);
  const s = rayBody([0, 0, 0], [0, 0, -1], w.bodies[0])!;
  assert.ok(Math.abs(s.t - 8) < 1e-9);
  assert.ok(Math.abs(s.normal[2] - 1) < 1e-9);
  assert.equal(w.raycast([0, 0, 0], [0, 1, 0]), null);
  assert.equal(w.raycast([0, 0, 0], [0, 0, -1], 3.9), null, "respects maxT");
});

test("sphere resting on a box edge is pushed out, not stuck inside", () => {
  const w = new PhysicsWorld();
  w.gravity = [0, 0, 0];
  w.add({ pos: [0, 0, 0], shape: { kind: "box", half: [1, 1, 1] } });
  const s = w.add({ pos: [0.2, 0.1, 0.1], shape: { kind: "sphere", r: 0.3 }, mass: 1 }); // centre inside
  for (let i = 0; i < 10; i++) w.step(1 / 60);
  const c = collide(s, w.bodies[0]);
  assert.ok(!c || c.depth < 0.005, `still ${c?.depth} deep`);
});
