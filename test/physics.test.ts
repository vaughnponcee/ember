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
    assert.ok(Math.abs(b.pos[0]) < 0.03 && Math.abs(b.pos[2]) < 0.03, `box ${i} drifted ${b.pos[0]}, ${b.pos[2]}`);
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
  w.add({ pos: [0, -0.5, 0], shape: { kind: "box", half: [400, 0.5, 400] } }); // wide: rolling balls must not leave it
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
    // lowest point of the body (boxes may be rotated)
    const bottom = b.shape.kind === "sphere" ? b.pos[1] - b.shape.r : Math.min(...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => {
      const h = (b.shape as { half: [number, number, number] }).half, q = b.rot;
      const v = [x * h[0], y * h[1], z * h[2]];
      // y component of q * v
      const tx = 2 * (q[1] * v[2] - q[2] * v[1]), tz = 2 * (q[0] * v[1] - q[1] * v[0]), ty = 2 * (q[2] * v[0] - q[0] * v[2]);
      return b.pos[1] + v[1] + q[3] * ty + q[2] * tx - q[0] * tz;
    }))));
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

// ---- rotation ---------------------------------------------------------------
const tiltQ = (ax: [number, number, number], ang: number): [number, number, number, number] => {
  const s = Math.sin(ang / 2), l = Math.hypot(...ax);
  return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(ang / 2)];
};
/** World-space up vector of a body's local axis i. */
const axis = (q: number[], i: number) => {
  const v = [0, 0, 0]; v[i] = 1;
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};

test("a box dropped on its corner tumbles and comes to rest flat on a face", () => {
  const w = new PhysicsWorld();
  floor(w);
  const b = w.add({ pos: [0, 3, 0], rot: tiltQ([1, 0.3, 0.7], 0.9), shape: { kind: "box", half: [0.5, 0.5, 0.5] }, mass: 1, restitution: 0.2 });
  let maxSpin = 0;
  for (let i = 0; i < 400; i++) { w.step(1 / 60); maxSpin = Math.max(maxSpin, Math.hypot(...b.angVel)); }
  assert.ok(maxSpin > 1, `it should actually tumble (max spin ${maxSpin})`);
  // resting on a face: some local axis points straight up, and the centre sits half a side above the floor
  const up = Math.max(...[0, 1, 2].map((i) => Math.abs(axis(b.rot, i)[1])));
  assert.ok(up > 0.995, `not flat: best axis alignment ${up}`);
  assert.ok(Math.abs(b.pos[1] - 0.5) < 0.03, `y=${b.pos[1]}`);
  assert.ok(b.sleeping);
});

test("a ball rolls down a tilted ramp and spins about the right axis", () => {
  const w = new PhysicsWorld();
  floor(w);
  // ramp tilted about z so it descends toward +x
  w.add({ pos: [0, 2, 0], rot: tiltQ([0, 0, 1], -0.35), shape: { kind: "box", half: [5, 0.2, 2] }, friction: 0.9 });
  const ball = w.add({ pos: [-3.5, 4.2, 0], shape: { kind: "sphere", r: 0.4 }, mass: 1, friction: 0.9 });
  for (let i = 0; i < 70; i++) w.step(1 / 60);
  assert.ok(ball.vel[0] > 2, `moving downhill: vx=${ball.vel[0]}`);
  // rolling toward +x spins about -z
  assert.ok(ball.angVel[2] < -3, `spin z=${ball.angVel[2]}`);
});

test("fixedRotation bodies never spin", () => {
  const w = new PhysicsWorld();
  floor(w);
  const c = w.add({ pos: [0, 1, 0], vel: [6, 0, 0], shape: { kind: "box", half: [0.4, 0.9, 0.4] }, mass: 1, friction: 1, fixedRotation: true });
  w.add({ pos: [2, 0.5, 0], shape: { kind: "box", half: [0.5, 0.5, 0.5] } });
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  assert.deepEqual(c.rot, [0, 0, 0, 1]);
});

test("a box pushed past a ledge tips over the edge", () => {
  const w = new PhysicsWorld();
  w.add({ pos: [0, 4.5, 0], shape: { kind: "box", half: [2, 0.5, 2] } }); // table top at y=5
  floor(w);
  const b = w.add({ pos: [1.75, 5.5, 0], shape: { kind: "box", half: [0.5, 0.5, 0.5] }, mass: 1, friction: 0.8 });
  for (let i = 0; i < 200; i++) w.step(1 / 60);
  assert.ok(b.pos[1] < 1, `fell off: y=${b.pos[1]}`);
  const tipped = Math.abs(axis(b.rot, 1)[1]) < 0.995 || b.pos[0] > 2.5;
  assert.ok(tipped);
});

test("raycast hits a rotated box on its real surface", () => {
  const w = new PhysicsWorld();
  w.add({ pos: [0, 0, -5], rot: tiltQ([0, 1, 0], Math.PI / 4), shape: { kind: "box", half: [1, 1, 1] } });
  const h = w.raycast([0, 0, 0], [0, 0, -1])!;
  // the corner of a 45 degree box points at the ray: distance 5 - sqrt(2)
  assert.ok(Math.abs(h.t - (5 - Math.SQRT2)) < 1e-6, `t=${h.t}`);
});
