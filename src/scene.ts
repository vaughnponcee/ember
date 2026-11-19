/**
 * Scene format shared by the editor and games: plain JSON, so scenes can be
 * saved, diffed and loaded at runtime.
 *
 * spawnScene() turns a scene into ECS entities with Transform, Model and
 * (optionally) a physics Body. syncAndDraw() is the standard render system.
 */
import type { Entity, World } from "./ecs.ts";
import type { Body, PhysicsWorld } from "./physics.ts";
import type { Mesh, PointLight, Renderer } from "./renderer.ts";
import { type Vec3, fromTRS, lerp, quatFromEuler } from "./math.ts";
import { fromBase64, parseModel } from "./gltf.ts";

export type MeshName = "box" | "sphere" | "cylinder" | "gem" | "plane" | `model:${string}`;
export type BodyKind = "none" | "static" | "dynamic" | "trigger";

export interface SceneObject {
  name: string;
  mesh: MeshName;
  pos: Vec3;
  size: Vec3;
  yaw?: number;
  color: Vec3;
  emissive?: number;
  rough?: number;
  checker?: boolean;
  body?: BodyKind;
  mass?: number;
  bounce?: number;
  friction?: number;
  /** Dynamic bodies only: never tip over or spin (characters). */
  upright?: boolean;
  /** Free-form tag for game code: "coin", "spawn", "enemy"... */
  tag?: string;
  light?: { color: Vec3; radius: number };
  /** Name of a script in Scene.scripts to attach. */
  script?: string;
}

export interface Scene {
  version: 1;
  name: string;
  sky?: Vec3;
  horizon?: Vec3;
  sunDir?: Vec3;
  fog?: number;
  /** Script sources by name; objects reference them with `script`. */
  scripts?: Record<string, string>;
  /** Imported glTF/GLB models, base64 encoded, referenced as mesh "model:<name>". */
  models?: Record<string, string>;
  objects: SceneObject[];
}

export interface Transform { pos: Vec3; prev: Vec3; size: Vec3; yaw: number }
export interface Model { mesh: Mesh; color: Vec3; emissive: number; rough: number; checker: boolean }

/** Component names used by the built-in systems. */
export const T = "transform", M = "model", B = "body", S = "source", L = "light";

/** Upload any scene models that aren't in the mesh table yet. Bad models are skipped and reported. */
export function loadModels(scene: Scene, R: Renderer, meshes: Record<string, Mesh>): string[] {
  const errors: string[] = [];
  for (const [name, data] of Object.entries(scene.models ?? {})) {
    const key = `model:${name}`;
    if (meshes[key]) continue;
    try { meshes[key] = R.createMesh(parseModel(fromBase64(data)).mesh); }
    catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  return errors;
}

export function spawnObject(o: SceneObject, world: World, phys: PhysicsWorld, R: Renderer, meshes: Record<string, Mesh>): Entity {
  const e = world.spawn();
  world.store<SceneObject>(S).set(e, o);
  world.store<Transform>(T).set(e, { pos: [...o.pos] as Vec3, prev: [...o.pos] as Vec3, size: [...o.size] as Vec3, yaw: o.yaw ?? 0 });
  world.store<Model>(M).set(e, { mesh: meshes[o.mesh] ?? meshes.box, color: o.color, emissive: o.emissive ?? 0, rough: o.rough ?? 0.6, checker: !!o.checker });
  const kind = o.body ?? "static";
  if (kind !== "none") {
    const sphere = o.mesh === "sphere" || o.mesh === "gem";
    const shape = sphere
      ? { kind: "sphere" as const, r: Math.max(o.size[0], o.size[1], o.size[2]) / 2 }
      : { kind: "box" as const, half: [o.size[0] / 2, (o.mesh === "plane" ? 0.05 : o.size[1] / 2), o.size[2] / 2] as Vec3 };
    const body = phys.add({
      pos: o.pos, shape, user: e, rot: quatFromEuler(o.yaw ?? 0),
      mass: kind === "dynamic" ? (o.mass ?? 1) : 0,
      trigger: kind === "trigger",
      restitution: o.bounce ?? 0.1,
      friction: o.friction ?? 0.6,
      fixedRotation: !!o.upright,
    });
    world.store<Body>(B).set(e, body);
  }
  if (o.light) {
    const l: PointLight = { pos: [...o.pos] as Vec3, color: o.light.color, radius: o.light.radius };
    R.lights.push(l);
    world.store<PointLight>(L).set(e, l);
  }
  return e;
}

export function spawnScene(scene: Scene, world: World, phys: PhysicsWorld, R: Renderer, meshes: Record<string, Mesh>): Map<string, Entity> {
  loadModels(scene, R, meshes);
  if (scene.sky) R.sky = scene.sky;
  if (scene.horizon) R.horizon = scene.horizon;
  if (scene.sunDir) { const d = scene.sunDir, l = Math.hypot(...d); R.sunDir = [d[0] / l, d[1] / l, d[2] / l]; }
  if (scene.fog !== undefined) R.fogDensity = scene.fog;
  const byName = new Map<string, Entity>();
  for (const o of scene.objects) byName.set(o.name, spawnObject(o, world, phys, R, meshes));
  return byName;
}

/** Call at the start of each fixed step so rendering can interpolate. */
export function savePrevious(world: World): void {
  const ts = world.store<Transform>(T), bs = world.store<Body>(B);
  for (let i = 0; i < bs.size; i++) {
    const e = bs.entities[i], t = ts.get(e);
    if (t) { const p = bs.dense[i].pos; t.prev[0] = p[0]; t.prev[1] = p[1]; t.prev[2] = p[2]; }
  }
}

/** Copy physics positions into transforms, move lights, and queue every model. */
export function syncAndDraw(world: World, R: Renderer, alpha: number, model = new Float32Array(16)): void {
  const ts = world.store<Transform>(T), ms = world.store<Model>(M), bs = world.store<Body>(B), ls = world.store<PointLight>(L);
  for (let i = 0; i < ms.size; i++) {
    const e = ms.entities[i], m = ms.dense[i], t = ts.get(e);
    if (!t) continue;
    const b = bs.get(e);
    if (b) { t.pos[0] = b.pos[0]; t.pos[1] = b.pos[1]; t.pos[2] = b.pos[2]; }
    const moving = b && b.invMass > 0;
    const px = moving ? lerp(t.prev[0], t.pos[0], alpha) : t.pos[0];
    const py = moving ? lerp(t.prev[1], t.pos[1], alpha) : t.pos[1];
    const pz = moving ? lerp(t.prev[2], t.pos[2], alpha) : t.pos[2];
    // moving bodies use their simulated orientation; everything else uses yaw
    fromTRS([px, py, pz], moving ? b.rot : quatFromEuler(t.yaw), t.size, model);
    R.draw(m.mesh, model, m.color, { emissive: m.emissive, rough: m.rough, checker: m.checker, shadow: m.emissive === 0 });
    const l = ls.get(e);
    if (l) { l.pos[0] = px; l.pos[1] = py; l.pos[2] = pz; }
  }
}

/** Current state of every entity that came from a scene, as a new Scene. */
export function serializeScene(world: World, base: Omit<Scene, "objects">): Scene {
  const src = world.store<SceneObject>(S), ts = world.store<Transform>(T), ms = world.store<Model>(M);
  const objects: SceneObject[] = [];
  for (let i = 0; i < src.size; i++) {
    const e = src.entities[i], o = src.dense[i], t = ts.get(e), m = ms.get(e);
    objects.push({ ...o, pos: t ? [...t.pos] as Vec3 : o.pos, size: t ? [...t.size] as Vec3 : o.size, yaw: t?.yaw ?? o.yaw, color: m ? [...m.color] as Vec3 : o.color });
  }
  return { ...base, objects };
}
