import { test } from "node:test";
import assert from "node:assert/strict";
import { box, cylinder, gem, plane, signedVolume, sphere, STRIDE } from "../src/mesh.ts";
import { FixedLoop } from "../src/loop.ts";
import { Particles } from "../src/particles.ts";
import { rng } from "../src/math.ts";

test("closed meshes have outward winding and the right volume", () => {
  assert.ok(Math.abs(signedVolume(box()) - 1) < 1e-6);
  const sv = signedVolume(sphere(48, 32));
  assert.ok(Math.abs(sv - (4 / 3) * Math.PI * 0.125) < 0.01, `sphere ${sv}`);
  const cv = signedVolume(cylinder(64));
  assert.ok(Math.abs(cv - Math.PI * 0.25) < 0.01, `cylinder ${cv}`);
  assert.ok(signedVolume(gem()) > 0);
});

test("normals are unit length and indices in range", () => {
  for (const m of [box(), sphere(), plane(4), cylinder(), gem()]) {
    const n = m.vertices.length / STRIDE;
    for (const i of m.indices) assert.ok(i < n);
    for (let k = 0; k < m.vertices.length; k += STRIDE)
      assert.ok(Math.abs(Math.hypot(m.vertices[k + 3], m.vertices[k + 4], m.vertices[k + 5]) - 1) < 1e-5);
  }
});

test("bounding radius covers every vertex", () => {
  const b = box();
  assert.ok(Math.abs(b.radius - Math.sqrt(3) / 2) < 1e-6);
});

test("fixed loop: same step count whatever the frame pacing", () => {
  const run = (frames: number[]) => {
    const l = new FixedLoop(1 / 60);
    let n = 0;
    for (const f of frames) l.advance(f, () => n++);
    return n;
  };
  const r = rng(5);
  const steady = run(Array(600).fill(1 / 60 + 1e-9));
  const jitter: number[] = [];
  let total = 0;
  while (total < 10 - 0.05) { const f = 0.004 + r() * 0.03; jitter.push(f); total += f; }
  jitter.push(10 - total + 1e-9);
  assert.equal(steady, 600);
  assert.equal(run(jitter), 600);
});

test("fixed loop drops time instead of spiralling after a long stall", () => {
  const l = new FixedLoop(1 / 60, 5);
  let n = 0;
  l.advance(3, () => n++);
  assert.equal(n, 5);
  assert.equal(l.dropped, 1);
});

test("particles: capacity respected, dead ones removed, survivors keep their data", () => {
  const p = new Particles(100);
  assert.equal(p.burst([0, 5, 0], [1, 0, 0], 80, 4, 0.5), 80);
  assert.equal(p.burst([0, 5, 0], [0, 1, 0], 80, 4, 5), 20);
  for (let i = 0; i < 60; i++) p.update(1 / 60); // 1 s: all short-lived red ones dead
  assert.equal(p.count, 20);
  for (let i = 0; i < p.count; i++) assert.equal(p.col[i * 3 + 1], 1, "only green survivors remain");
  for (let i = 0; i < 400; i++) p.update(1 / 60);
  assert.equal(p.count, 0);
});

test("animator: loops, holds the last frame of one-shots, switches animations", async () => {
  const { Animator } = await import("../src/assets.ts");
  const frames = Array.from({ length: 6 }, (_, i) => ({ tex: null, x: i * 16, y: 0, w: 16, h: 16 }));
  const sprite = { asset: { kind: "sprite", name: "t", w: 16, h: 16, frames: [], anims: [
    { name: "run", from: 1, to: 3, fps: 10, loop: true },
    { name: "die", from: 4, to: 5, fps: 10, loop: false },
  ] }, tex: null, frames } as never;
  const a = new Animator(sprite, "run");
  const seen: number[] = [];
  for (let i = 0; i < 7; i++) { seen.push(a.index()); a.update(0.1); }
  assert.deepEqual(seen, [1, 2, 3, 1, 2, 3, 1]);
  a.play("die");
  a.update(1);
  assert.equal(a.index(), 5);
  assert.ok(a.done);
  a.play("die"); // same animation: no restart
  assert.equal(a.index(), 5);
});
