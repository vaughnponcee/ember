import { test } from "node:test";
import assert from "node:assert/strict";
import { Tilemap } from "../src/tilemap.ts";
import { rng } from "../src/math.ts";

const map = () => {
  const m = Tilemap.fromStrings([
    "..........",
    "..........",
    "....==....",
    "..........",
    "#........#",
    "##########",
  ], 16, { "#": 1, "=": 2 });
  m.solid.add(1);
  m.oneWay.add(2);
  return m;
};

test("falling box lands exactly on the floor", () => {
  const m = map();
  const b = { x: 20, y: 0, w: 12, h: 14 };
  let r;
  for (let i = 0; i < 40; i++) r = m.moveAndCollide(b, 0, 6);
  assert.equal(b.y + b.h, 5 * 16);
  assert.ok(r!.onGround);
  assert.ok(m.grounded(b));
});

test("walls stop horizontal motion flush against them", () => {
  const m = map();
  const b = { x: 40, y: 50, w: 12, h: 14 };
  m.moveAndCollide(b, 0, 30);
  const r = m.moveAndCollide(b, -200, 0);
  assert.ok(r.hitX);
  assert.equal(b.x, 16);
  m.moveAndCollide(b, 500, 0);
  assert.equal(b.x + b.w, 9 * 16);
});

test("one-way platform: pass through from below, land from above, drop through on request", () => {
  const m = map();
  const b = { x: 66, y: 60, w: 12, h: 14 };
  m.moveAndCollide(b, 0, -40); // jump up through row 2
  assert.ok(b.y < 2 * 16, "went through from below");
  b.y = 10;
  const r = m.moveAndCollide(b, 0, 20);
  assert.ok(r.onGround);
  assert.equal(b.y + b.h, 2 * 16);
  const d = m.moveAndCollide(b, 0, 4, true);
  assert.ok(!d.onGround && b.y + b.h > 2 * 16, "dropped through");
});

test("ceiling stops upward motion", () => {
  const m = Tilemap.fromStrings(["####", "....", "....", "####"], 16, { "#": 1 });
  m.solid.add(1);
  const b = { x: 10, y: 30, w: 10, h: 10 };
  const r = m.moveAndCollide(b, 0, -50);
  assert.ok(r.hitCeiling);
  assert.equal(b.y, 16);
});

test("fuzz: huge random moves never end inside a solid tile", () => {
  const m = map();
  const r = rng(9);
  const b = { x: 40, y: 40, w: 11, h: 13 };
  for (let i = 0; i < 20000; i++) {
    m.moveAndCollide(b, (r() * 2 - 1) * 90, (r() * 2 - 1) * 90);
    for (const [cx, cy] of [[b.x, b.y], [b.x + b.w - 0.01, b.y], [b.x, b.y + b.h - 0.01], [b.x + b.w - 0.01, b.y + b.h - 0.01]])
      assert.ok(!m.isSolid(Math.floor(cx / 16), Math.floor(cy / 16)), `inside wall at step ${i}`);
    if (b.y > 200 || b.y < -400) { b.x = 40; b.y = 40; } // fell in a pit or flew off
  }
});
