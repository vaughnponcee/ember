/**
 * Project templates shared by the hub (new project dialog) and the editor.
 */
import type { Scene } from "../src/scene.ts";

const STARTER: Scene = {
  version: 1, name: "untitled", fog: 0.0065,
  scripts: {
    player: `// Attached to "player". Runs every fixed step (60 per second).
function start(self, game) {
  game.state.score = 0;
  game.follow(self, 9, 4);          // camera follows this object
}

function update(self, game, dt) {
  const m = game.input.axes();      // WASD / arrows / gamepad
  const speed = game.input.held("ShiftLeft") ? 9 : 6;
  // move relative to where the camera looks
  const cam = game.camera, fx = cam.target[0] - cam.pos[0], fz = cam.target[2] - cam.pos[2];
  const l = Math.hypot(fx, fz) || 1, f = [fx / l, fz / l], r = [-f[1], f[0]];
  const v = self.velocity;
  self.velocity = [(f[0] * m.y + r[0] * m.x) * speed, v[1], (f[1] * m.y + r[1] * m.x) * speed];
  if (game.input.pressed("Space") && self.grounded) {
    self.velocity = [self.velocity[0], 9, self.velocity[2]];
    game.sound.jump();
  }
  if (self.position[1] < -10) self.position = [0, 4, 6];
  game.print("Crystals: " + game.state.score + " / " + game.state.total);
}

function onTrigger(self, other, game) {
  if (other.tag === "coin") {
    other.destroy();
    game.state.score++;
    game.sound.pickup(1 + game.state.score * 0.05);
  }
}`,
    spin: `// Spins and bobs the object it is attached to.
function start(self, game) {
  self.state.y = self.position[1];
  game.state.total = game.findAll("coin").length;
}
function update(self, game) {
  self.rotation += 0.04;
  const p = self.position;
  self.position = [p[0], self.state.y + Math.sin(game.time * 2) * 0.2, p[2]];
}`,
  },
  objects: [
    { name: "player", mesh: "sphere", pos: [0, 2, 6], size: [0.9, 0.9, 0.9], color: [0.95, 0.42, 0.18], body: "dynamic", mass: 2, rough: 0.3, friction: 0, script: "player" },
    { name: "ground", mesh: "box", pos: [0, -0.5, 0], size: [30, 1, 30], color: [0.42, 0.55, 0.38], checker: true, rough: 0.95, body: "static" },
    { name: "tower", mesh: "box", pos: [0, 1, 0], size: [4, 2, 4], color: [0.62, 0.63, 0.66], body: "static" },
    { name: "ramp", mesh: "box", pos: [5, 0.5, -3], size: [3, 1, 6], color: [0.55, 0.45, 0.35], body: "static", yaw: 0.3 },
    { name: "crate", mesh: "box", pos: [-3, 4, 2], size: [1, 1, 1], color: [0.7, 0.48, 0.28], body: "dynamic", mass: 2 },
    { name: "crate 2", mesh: "box", pos: [-3.2, 6, 2.3], size: [1, 1, 1], color: [0.7, 0.48, 0.28], body: "dynamic", mass: 2 },
    { name: "ball", mesh: "sphere", pos: [1.2, 6, 0.6], size: [1, 1, 1], color: [0.85, 0.3, 0.25], body: "dynamic", mass: 1, bounce: 0.6, rough: 0.2 },
    { name: "lamp", mesh: "sphere", pos: [-5, 2.5, -4], size: [0.5, 0.5, 0.5], color: [1, 0.75, 0.4], emissive: 3, body: "none", light: { color: [3, 2, 1], radius: 8 } },
    { name: "crystal", mesh: "gem", pos: [0, 3, 0], size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin", script: "spin", light: { color: [0.6, 1.6, 2], radius: 4 } },
    { name: "crystal 2", mesh: "gem", pos: [8, 1.2, 6], size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin", script: "spin" },
    { name: "crystal 3", mesh: "gem", pos: [-8, 1.2, -6], size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin", script: "spin" },
  ],
};

const GROUND = { name: "ground", mesh: "box", pos: [0, -0.5, 0], size: [30, 1, 30], color: [0.42, 0.55, 0.38], checker: true, rough: 0.95, body: "static" } as const;

const EMPTY: Scene = {
  version: 1, name: "main", fog: 0.0065, scripts: {},
  objects: [structuredClone(GROUND) as Scene["objects"][number]],
};

const PHYSICS: Scene = {
  version: 1, name: "main", fog: 0.006,
  scripts: {
    spawner: `// Drops a crate every half second while you hold Space.
function update(self, game) {
  game.print("Hold Space to drop crates. " + game.findAll("crate").length + " crates");
  if (game.input.held("Space") && game.time - (self.state.last || 0) > 0.5) {
    self.state.last = game.time;
    const x = (Math.random() - 0.5) * 4, z = (Math.random() - 0.5) * 4;
    game.spawn({ name: "crate", mesh: "box", tag: "crate", pos: [x, 9, z], size: [0.8, 0.8, 0.8], color: [0.7, 0.48, 0.28], body: "dynamic", mass: 1, yaw: Math.random() * 3 });
  }
}`,
  },
  objects: [
    { ...structuredClone(GROUND), script: "spawner" } as Scene["objects"][number],
    { name: "slab", mesh: "box", pos: [4, 0.2, 0], size: [6, 0.4, 3], color: [0.6, 0.6, 0.64], body: "static" },
    ...Array.from({ length: 6 }, (_, i) => ({ name: `stack ${i + 1}`, mesh: "box" as const, pos: [-4, 0.5 + i * 1.01, -2] as [number, number, number], size: [1, 1, 1] as [number, number, number], color: [0.7, 0.48, 0.28] as [number, number, number], body: "dynamic" as const, mass: 1 })),
    ...Array.from({ length: 5 }, (_, i) => ({ name: `ball ${i + 1}`, mesh: "sphere" as const, pos: [-1 + i * 0.6, 5 + i, 3] as [number, number, number], size: [0.7, 0.7, 0.7] as [number, number, number], color: [0.85, 0.3 + i * 0.1, 0.25] as [number, number, number], body: "dynamic" as const, mass: 1, bounce: 0.5, rough: 0.2 })),
    { name: "lamp", mesh: "sphere", pos: [0, 4, 0], size: [0.4, 0.4, 0.4], color: [1, 0.8, 0.5], emissive: 3, body: "none", light: { color: [3, 2.2, 1.4], radius: 10 } },
  ],
};

export interface Template { id: string; name: string; kind: "3D" | "2D"; blurb: string; scene: Scene; tab?: "scene" | "sprites" }

export const TEMPLATES: Template[] = [
  { id: "starter", name: "3D Starter", kind: "3D", blurb: "A playable scene: a rolling player with a movement script, a follow camera, crystals to collect, crates and lights. The quickest way to see scripts and physics working together.", scene: STARTER },
  { id: "empty", name: "Empty 3D", kind: "3D", blurb: "Just a ground plane and the default sky. Start from nothing.", scene: EMPTY },
  { id: "physics", name: "Physics Playground", kind: "3D", blurb: "A crate stack, a slab and bouncing balls, plus a script that drops tumbling crates while you hold Space.", scene: PHYSICS },
  { id: "sprites", name: "2D Sprites", kind: "2D", blurb: "Opens the sprite editor: draw pixel art frame by frame and set up animations. Name a sprite hero with idle, run and jump animations and it becomes the player in the Moss Ledge demo.", scene: EMPTY, tab: "sprites" },
];

export function templateScene(id: string, name: string): Scene {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  return { ...structuredClone(t.scene), name: "main", project: name } as Scene;
}
