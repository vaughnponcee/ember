import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/ecs.ts";
import { PhysicsWorld } from "../src/physics.ts";
import { spawnScene, type Scene } from "../src/scene.ts";
import { ScriptRuntime } from "../src/script.ts";

// The runtime only needs these parts of the renderer, input and audio in Node.
const R = { lights: [] as unknown[], sky: [0, 0, 0], horizon: [0, 0, 0], sunDir: [0, 1, 0], fogDensity: 0 } as never;
const meshes = { box: {}, sphere: {}, cylinder: {}, gem: {}, plane: {} } as never;
const keys = new Set<string>();
const input = { held: (k: string) => keys.has(k), pressed: (k: string) => keys.has(k), axes: () => ({ x: keys.has("KeyD") ? 1 : 0, y: 0 }) } as never;
const sound = { pickup() {}, jump() {} } as never;
const camera = { pos: [0, 0, 0], target: [0, 0, 0], fov: 1, near: 0.1, far: 100 } as never;

function run(scene: Scene, steps: number, each?: (rt: ScriptRuntime) => void) {
  const world = new World(), phys = new PhysicsWorld();
  spawnScene(scene, world, phys, R, meshes);
  const rt = new ScriptRuntime(world, phys, R, meshes, scene.scripts ?? {}, input, sound, camera);
  rt.attachAll();
  for (let i = 0; i < steps; i++) {
    each?.(rt);
    rt.update(1 / 60);
    const contacts = phys.step(1 / 60);
    rt.dispatch(contacts);
    world.flush();
  }
  return { world, phys, rt };
}

const ground = { name: "ground", mesh: "box" as const, pos: [0, -0.5, 0] as [number, number, number], size: [40, 1, 40] as [number, number, number], color: [1, 1, 1] as [number, number, number] };

test("update moves a scripted body from input", () => {
  keys.clear(); keys.add("KeyD");
  const { rt } = run({
    version: 1, name: "t", scripts: { mover: "function update(self, game) { const m = game.input.axes(); self.velocity = [m.x * 5, self.velocity[1], 0]; }" },
    objects: [ground, { name: "p", mesh: "sphere", pos: [0, 1, 0], size: [1, 1, 1], color: [1, 1, 1], body: "dynamic", script: "mover" }],
  }, 60);
  const p = rt.api.find("p")!;
  assert.ok(p.position[0] > 4.5, `x=${p.position[0]}`);
  assert.equal(rt.errors.length, 0);
});

test("start runs once and state persists per object", () => {
  keys.clear();
  const { rt } = run({
    version: 1, name: "t", scripts: { c: "function start(self) { self.state.n = 0; } function update(self) { self.state.n++; }" },
    objects: [{ ...ground, script: "c" }],
  }, 10);
  assert.equal(rt.api.find("ground")!.state.n, 10);
});

test("onTrigger collects coins and destroy removes them", () => {
  keys.clear();
  const { rt, world } = run({
    version: 1, name: "t",
    scripts: { player: "function start(s, g) { g.state.score = 0; } function onTrigger(self, other, g) { if (other.tag === 'coin') { other.destroy(); g.state.score++; } }" },
    objects: [
      ground,
      { name: "p", mesh: "sphere", pos: [0, 3, 0], size: [1, 1, 1], color: [1, 1, 1], body: "dynamic", script: "player" },
      { name: "c1", mesh: "gem", pos: [0, 1, 0], size: [1, 1, 1], color: [1, 1, 1], body: "trigger", tag: "coin" },
      { name: "c2", mesh: "gem", pos: [9, 1, 0], size: [1, 1, 1], color: [1, 1, 1], body: "trigger", tag: "coin" },
    ],
  }, 120);
  assert.equal(rt.api.state.score, 1);
  assert.equal(rt.api.find("c1"), null);
  assert.ok(rt.api.find("c2"));
  assert.equal(rt.api.findAll("coin").length, 1);
  void world;
});

test("spawn creates scripted objects at runtime", () => {
  keys.clear();
  const { rt } = run({
    version: 1, name: "t",
    scripts: {
      gun: "function update(self, g) { if (g.time < 0.1) g.spawn({ name: 'bullet', mesh: 'sphere', pos: [0, 5, 0], size: [0.2,0.2,0.2], tag: 'b' }, 'bullet'); }",
      bullet: "function start(self) { self.velocity = [10, 0, 0]; }",
    },
    objects: [{ ...ground, script: "gun" }],
  }, 30);
  const bs = rt.api.findAll("b");
  assert.equal(bs.length, 6);
  assert.ok(bs[0].position[0] > 3);
});

test("errors are reported with the script name and the broken script stops", () => {
  keys.clear();
  const { rt } = run({
    version: 1, name: "t",
    scripts: { bad: "function update(self) { self.nope.x = 1; }", syntax: "function update( {" },
    objects: [{ ...ground, script: "bad" }, { name: "x", mesh: "box", pos: [5, 1, 0], size: [1, 1, 1], color: [1, 1, 1], script: "syntax" }],
  }, 20);
  assert.equal(rt.errors.length, 2, JSON.stringify(rt.errors));
  assert.ok(rt.errors.some((e) => e.script === "bad" && e.object === "ground"));
  assert.ok(rt.errors.some((e) => e.script === "syntax"));
});

test("raycast reports the object it hit", () => {
  keys.clear();
  const { rt } = run({ version: 1, name: "t", objects: [ground, { name: "wall", mesh: "box", pos: [5, 1, 0], size: [1, 2, 4], color: [1, 1, 1] }] }, 1);
  const h = rt.api.raycast([0, 1, 0], [1, 0, 0])!;
  assert.equal(h.object!.name, "wall");
  assert.ok(Math.abs(h.distance - 4.5) < 1e-9);
});
