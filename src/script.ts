/**
 * Scripting: attach behaviour to scene objects, Unity-style.
 *
 * A script is JavaScript source stored in the scene. It defines lifecycle
 * functions that the engine calls with a handle to the object it is attached
 * to (`self`) and the engine API (`game`):
 *
 *   function start(self, game) { self.state.speed = 4; }
 *   function update(self, game, dt) {
 *     const m = game.input.axes();
 *     self.velocity = [m.x * self.state.speed, self.velocity[1], -m.y * self.state.speed];
 *     if (game.input.pressed("Space") && self.grounded) self.velocity[1] = 9;
 *   }
 *   function onTrigger(self, other, game) {
 *     if (other.tag === "coin") { other.destroy(); game.state.score++; game.sound.pickup(); }
 *   }
 *
 * Scripts run in the page with the engine API in scope; they are your own
 * game code, not untrusted input.
 */
import type { Entity, World } from "./ecs.ts";
import type { Body, PhysicsWorld } from "./physics.ts";
import type { Renderer, Camera } from "./renderer.ts";
import type { Input } from "./input.ts";
import type { Sfx } from "./audio.ts";
import type { Mesh } from "./renderer.ts";
import { type SceneObject, type Transform, type Model, type MeshName, spawnObject, S, T, M, B } from "./scene.ts";
import type { Vec3 } from "./math.ts";

export interface ScriptHooks {
  start?(self: ObjectHandle, game: GameApi): void;
  update?(self: ObjectHandle, game: GameApi, dt: number): void;
  onTrigger?(self: ObjectHandle, other: ObjectHandle, game: GameApi): void;
  onCollide?(self: ObjectHandle, other: ObjectHandle, game: GameApi): void;
  onDestroy?(self: ObjectHandle, game: GameApi): void;
}

export interface ScriptError { script: string; object: string; message: string }

/** What scripts see for a scene object. */
export class ObjectHandle {
  /** Per-object storage for your script's variables. */
  state: Record<string, unknown> = {};
  readonly entity: Entity;
  private rt: ScriptRuntime;

  constructor(rt: ScriptRuntime, e: Entity) { this.rt = rt; this.entity = e; }

  private get src() { return this.rt.world.store<SceneObject>(S).get(this.entity); }
  private get tr() { return this.rt.world.store<Transform>(T).get(this.entity); }
  private get body() { return this.rt.world.store<Body>(B).get(this.entity); }

  get alive(): boolean { return this.rt.world.alive(this.entity); }
  get name(): string { return this.src?.name ?? ""; }
  get tag(): string { return this.src?.tag ?? ""; }

  get position(): Vec3 { return this.body?.pos ?? this.tr?.pos ?? [0, 0, 0]; }
  set position(p: Vec3) {
    const b = this.body, t = this.tr;
    if (b) { b.pos = [...p] as Vec3; b.sleeping = false; }
    if (t) { t.pos = [...p] as Vec3; t.prev = [...p] as Vec3; }
  }
  get velocity(): Vec3 { return this.body?.vel ?? [0, 0, 0]; }
  set velocity(v: Vec3) { const b = this.body; if (b) { b.vel = [...v] as Vec3; b.sleeping = false; } }
  /** True when resting on something (dynamic bodies only). */
  get grounded(): boolean { return !!this.body?.grounded; }
  /** Heading in radians (rotation about the vertical axis). */
  get rotation(): number { return this.tr?.yaw ?? 0; }
  set rotation(y: number) {
    const t = this.tr, b = this.body;
    if (t) t.yaw = y;
    if (b) { const h = y / 2; b.rot = [0, Math.sin(h), 0, Math.cos(h)]; b.angVel = [0, 0, 0]; }
  }
  /** Angular velocity in radians per second (dynamic bodies tumble on their own). */
  get spin(): Vec3 { return this.body?.angVel ?? [0, 0, 0]; }
  set spin(w: Vec3) { const b = this.body; if (b) { b.angVel = [...w] as Vec3; b.sleeping = false; } }
  get scale(): Vec3 { return this.tr?.size ?? [1, 1, 1]; }
  set scale(s: Vec3) { const t = this.tr; if (t) t.size = [...s] as Vec3; }
  get color(): Vec3 { return this.rt.world.store<Model>(M).get(this.entity)?.color ?? [1, 1, 1]; }
  set color(c: Vec3) { const m = this.rt.world.store<Model>(M).get(this.entity); if (m) m.color = [...c] as Vec3; }
  get visible(): boolean { return this.rt.world.store<Model>(M).has(this.entity); }

  /** Add an instant change in velocity. */
  push(v: Vec3): void { const b = this.body; if (b) { b.vel[0] += v[0]; b.vel[1] += v[1]; b.vel[2] += v[2]; b.sleeping = false; } }
  destroy(): void { this.rt.destroy(this.entity); }
  distanceTo(o: ObjectHandle): number { const a = this.position, b = o.position; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
}

/** The engine API given to every script as `game`. */
export interface GameApi {
  input: Input;
  sound: Sfx;
  camera: Camera;
  /** Seconds since play started. */
  time: number;
  /** Shared storage for all scripts (score, lives, flags). */
  state: Record<string, unknown>;
  find(name: string): ObjectHandle | null;
  findAll(tag: string): ObjectHandle[];
  spawn(o: Partial<SceneObject> & { mesh: MeshName }, script?: string): ObjectHandle;
  raycast(from: Vec3, dir: Vec3, max?: number): { object: ObjectHandle | null; point: Vec3; distance: number } | null;
  /** Make the camera follow an object (pass null to stop). */
  follow(obj: ObjectHandle | null, distance?: number, height?: number): void;
  /** Show text on screen this frame. */
  print(text: string): void;
  log(...args: unknown[]): void;
}

export class ScriptRuntime {
  readonly world: World;
  readonly phys: PhysicsWorld;
  readonly R: Renderer;
  readonly meshes: Record<string, Mesh>;
  readonly sources: Record<string, string>;
  readonly api: GameApi;
  errors: ScriptError[] = [];
  follow: { obj: ObjectHandle; distance: number; height: number } | null = null;
  printed: string[] = [];
  logs: string[] = [];

  private compiled = new Map<string, ScriptHooks | null>();
  private attached = new Map<Entity, { hooks: ScriptHooks; name: string; handle: ObjectHandle; started: boolean }>();
  private handles = new Map<Entity, ObjectHandle>();

  constructor(world: World, phys: PhysicsWorld, R: Renderer, meshes: Record<string, Mesh>, sources: Record<string, string>, input: Input, sound: Sfx, camera: Camera) {
    this.world = world; this.phys = phys; this.R = R; this.meshes = meshes; this.sources = sources;
    const rt = this;
    this.api = {
      input, sound, camera, time: 0, state: {},
      find: (name) => {
        const src = world.store<SceneObject>(S);
        for (let i = 0; i < src.size; i++) if (src.dense[i].name === name) return rt.handle(src.entities[i]);
        return null;
      },
      findAll: (tag) => {
        const src = world.store<SceneObject>(S), out: ObjectHandle[] = [];
        for (let i = 0; i < src.size; i++) if (src.dense[i].tag === tag) out.push(rt.handle(src.entities[i]));
        return out;
      },
      spawn: (o, script) => {
        const full: SceneObject = { name: o.mesh, pos: [0, 0, 0], size: [1, 1, 1], color: [0.8, 0.8, 0.8], body: "dynamic", ...o, script: script ?? o.script };
        const e = spawnObject(full, world, phys, R, meshes);
        rt.attach(e, full);
        return rt.handle(e);
      },
      raycast: (from, dir, max = 100) => {
        const h = phys.raycast(from, dir, max);
        if (!h) return null;
        const e = h.body.user as Entity | undefined;
        return { object: e !== undefined && world.alive(e) ? rt.handle(e) : null, point: h.point, distance: h.t };
      },
      follow: (obj, distance = 9, height = 4) => { rt.follow = obj ? { obj, distance, height } : null; },
      print: (t) => { rt.printed.push(String(t)); },
      log: (...a) => { rt.logs.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); if (rt.logs.length > 200) rt.logs.shift(); },
    };
  }

  handle(e: Entity): ObjectHandle {
    let h = this.handles.get(e);
    if (!h) { h = new ObjectHandle(this, e); this.handles.set(e, h); }
    return h;
  }

  /** Compile a script by name once. Syntax errors are reported, not thrown. */
  private compile(name: string): ScriptHooks | null {
    if (this.compiled.has(name)) return this.compiled.get(name)!;
    const code = this.sources[name];
    let hooks: ScriptHooks | null = null;
    if (code === undefined) this.errors.push({ script: name, object: "", message: `script "${name}" does not exist` });
    else {
      try {
        // the script declares plain functions; collect the ones it defined
        const factory = new Function(`"use strict";\n${code}\n;return {` +
          ["start", "update", "onTrigger", "onCollide", "onDestroy"].map((k) => `${k}: typeof ${k} === "function" ? ${k} : undefined`).join(",") + "};");
        hooks = factory() as ScriptHooks;
      } catch (err) {
        this.errors.push({ script: name, object: "", message: (err as Error).message });
      }
    }
    this.compiled.set(name, hooks);
    return hooks;
  }

  attach(e: Entity, o: SceneObject): void {
    if (!o.script) return;
    const hooks = this.compile(o.script);
    if (hooks) this.attached.set(e, { hooks, name: o.script, handle: this.handle(e), started: false });
  }

  attachAll(): void {
    const src = this.world.store<SceneObject>(S);
    for (let i = 0; i < src.size; i++) this.attach(src.entities[i], src.dense[i]);
  }

  private call(e: Entity, fn: () => void) {
    try { fn(); } catch (err) {
      const a = this.attached.get(e);
      this.errors.push({ script: a?.name ?? "?", object: a?.handle.name ?? "?", message: (err as Error).message });
      this.attached.delete(e); // stop a broken script instead of spamming the same error every frame
    }
  }

  destroy(e: Entity): void {
    if (!this.world.alive(e)) return;
    const a = this.attached.get(e);
    if (a?.hooks.onDestroy) this.call(e, () => a.hooks.onDestroy!(a.handle, this.api));
    const b = this.world.store<Body>(B).get(e);
    if (b) this.phys.remove(b);
    const light = this.world.store<{ radius: number }>("light").get(e);
    if (light) light.radius = 0;
    this.attached.delete(e);
    this.world.destroyLater(e);
  }

  /** Run start (first time) and update for every scripted object. */
  update(dt: number): void {
    this.api.time += dt;
    for (const [e, a] of [...this.attached]) {
      if (!this.world.alive(e)) { this.attached.delete(e); continue; }
      if (!a.started) { a.started = true; if (a.hooks.start) this.call(e, () => a.hooks.start!(a.handle, this.api)); }
      if (a.hooks.update && this.attached.has(e)) this.call(e, () => a.hooks.update!(a.handle, this.api, dt));
    }
  }

  /** Deliver this step's trigger overlaps and collisions to scripts. */
  dispatch(contacts: { a: Body; b: Body }[]): void {
    const send = (pairs: { a: Body; b: Body }[], kind: "onTrigger" | "onCollide") => {
      for (const c of pairs) {
        const ea = c.a.user as Entity | undefined, eb = c.b.user as Entity | undefined;
        if (ea === undefined || eb === undefined) continue;
        for (const [self, other] of [[ea, eb], [eb, ea]] as const) {
          const s = this.attached.get(self);
          const fn = s?.hooks[kind];
          if (fn && this.world.alive(self) && this.world.alive(other)) this.call(self, () => fn(s.handle, this.handle(other), this.api));
        }
      }
    };
    send(this.phys.triggerEvents, "onTrigger");
    send(contacts, "onCollide");
  }
}
