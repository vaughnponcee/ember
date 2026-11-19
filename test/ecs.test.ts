import { test } from "node:test";
import assert from "node:assert/strict";
import { World, entityIndex } from "../src/ecs.ts";

test("recycled slot gets a new generation; stale handle is dead", () => {
  const w = new World();
  const a = w.spawn();
  w.store<number>("hp").set(a, 10);
  w.destroy(a);
  const b = w.spawn();
  assert.equal(entityIndex(a), entityIndex(b));
  assert.notEqual(a, b);
  assert.ok(!w.alive(a));
  assert.ok(w.alive(b));
  assert.equal(w.store<number>("hp").get(a), undefined);
  assert.equal(w.store<number>("hp").get(b), undefined, "new entity must not inherit components");
});

test("swap-remove keeps every remaining value attached to the right entity", () => {
  const w = new World();
  const s = w.store<number>("v");
  const es = Array.from({ length: 200 }, () => w.spawn());
  es.forEach((e, i) => s.set(e, i));
  for (let i = 0; i < 200; i += 3) w.destroy(es[i]);
  es.forEach((e, i) => assert.equal(s.get(e), i % 3 === 0 ? undefined : i));
  assert.equal(s.size, 200 - 67);
});

test("query returns exactly the entities with all components", () => {
  const w = new World();
  const pos = w.store<number>("pos"), vel = w.store<number>("vel");
  const both: number[] = [];
  for (let i = 0; i < 100; i++) {
    const e = w.spawn();
    pos.set(e, i);
    if (i % 4 === 0) { vel.set(e, i); both.push(e); }
  }
  assert.deepEqual([...w.query("pos", "vel")].sort(), both.sort());
});

test("destroying during a query neither skips nor repeats entities", () => {
  const w = new World();
  const s = w.store<number>("x");
  for (let i = 0; i < 50; i++) s.set(w.spawn(), i);
  const seen: number[] = [];
  for (const e of w.query("x")) {
    seen.push(s.get(e)!);
    w.destroy(e);
  }
  assert.equal(seen.length, 50);
  assert.equal(new Set(seen).size, 50);
  assert.equal(w.count, 0);
});

test("destroyLater defers until flush", () => {
  const w = new World();
  const e = w.spawn();
  w.destroyLater(e);
  assert.ok(w.alive(e));
  assert.equal(w.flush(), 1);
  assert.ok(!w.alive(e));
});

test("sparse index grows past the initial capacity", () => {
  const w = new World();
  const s = w.store<number>("x");
  let last = 0;
  for (let i = 0; i < 5000; i++) { last = w.spawn(); s.set(last, i); }
  assert.equal(s.get(last), 4999);
});
