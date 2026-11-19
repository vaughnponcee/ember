import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cross, frustumPlanes, fromTRS, identity, invert, lookAt, multiply, perspective,
  quatFromEuler, quatMul, rng, rotateVec, sphereInFrustum, transformPoint, type Vec3,
} from "../src/math.ts";

const close = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const close3 = (a: Vec3, b: Vec3, eps = 1e-4) => a.forEach((x, i) => close(x, b[i], eps));

test("cross product follows the right hand rule", () => {
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
});

test("matrix inverse round trips random TRS matrices", () => {
  const r = rng(7);
  for (let k = 0; k < 50; k++) {
    const m = fromTRS([r() * 20 - 10, r() * 20 - 10, r() * 20 - 10], quatFromEuler(r() * 6, r() * 3 - 1.5, r()), [0.5 + r() * 3, 0.5 + r() * 3, 0.5 + r() * 3]);
    const p = multiply(m, invert(m)!);
    const id = identity();
    for (let i = 0; i < 16; i++) close(p[i], id[i], 1e-4);
  }
});

test("singular matrix has no inverse", () => {
  assert.equal(invert(new Float32Array(16)), null);
});

test("lookAt puts the target on the -Z axis in view space", () => {
  const v = lookAt([3, 4, 5], [10, 2, -1], [0, 1, 0]);
  const p = transformPoint(v, [10, 2, -1]);
  close(p[0], 0); close(p[1], 0);
  assert.ok(p[2] < 0);
  close3(transformPoint(v, [3, 4, 5]), [0, 0, 0]);
});

test("lookAt straight down does not produce NaN", () => {
  const v = lookAt([0, 10, 0], [0, 0, 0], [0, 1, 0]);
  for (const x of v) assert.ok(Number.isFinite(x));
});

test("perspective maps near and far planes to -1 and 1", () => {
  const p = perspective(Math.PI / 3, 16 / 9, 0.5, 200);
  close(transformPoint(p, [0, 0, -0.5])[2], -1);
  close(transformPoint(p, [0, 0, -200])[2], 1, 1e-3);
});

test("quaternion rotation matches the TRS matrix", () => {
  const q = quatMul(quatFromEuler(0.7), quatFromEuler(0, 0.3));
  const m = fromTRS([0, 0, 0], q, [1, 1, 1]);
  const v: Vec3 = [1, 2, 3];
  close3(rotateVec(q, v), transformPoint(m, v));
});

test("yaw of 90 degrees turns -Z into -X", () => {
  close3(rotateVec(quatFromEuler(Math.PI / 2), [0, 0, -1]), [-1, 0, 0]);
});

test("frustum culling: in front visible, behind and far off-axis culled", () => {
  const vp = multiply(perspective(Math.PI / 3, 1, 0.1, 100), lookAt([0, 0, 0], [0, 0, -1], [0, 1, 0]));
  const pl = frustumPlanes(vp);
  assert.ok(sphereInFrustum(pl, [0, 0, -10], 1));
  assert.ok(!sphereInFrustum(pl, [0, 0, 10], 1));
  assert.ok(!sphereInFrustum(pl, [50, 0, -10], 1));
  assert.ok(!sphereInFrustum(pl, [0, 0, -150], 1));
  // straddling the left plane still counts as visible
  assert.ok(sphereInFrustum(pl, [-6.2, 0, -10], 1));
});

test("rng is deterministic and in [0,1)", () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});
