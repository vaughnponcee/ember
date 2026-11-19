/**
 * Engine: wires renderer, 2D batch, physics, ECS, input, audio and the fixed
 * loop together so a game only writes its own logic.
 *
 *   const eng = new Engine(canvas);
 *   eng.run({
 *     fixedUpdate(dt) { ...game logic at 60 Hz... },
 *     draw3d(alpha)   { ...queue models (or use the scene system)... },
 *     draw2d(sb, w, h){ ...HUD in screen pixels... },
 *   });
 *
 * F3 toggles a performance overlay. The tab being hidden pauses the loop.
 */
import { World } from "./ecs.ts";
import { PhysicsWorld } from "./physics.ts";
import { Renderer, type Camera, type Mesh } from "./renderer.ts";
import { SpriteBatch } from "./sprites.ts";
import { FixedLoop } from "./loop.ts";
import { Input } from "./input.ts";
import { Sfx } from "./audio.ts";
import { box, cylinder, gem, plane, sphere } from "./mesh.ts";
import type { MeshName } from "./scene.ts";

export interface Game {
  fixedUpdate?(dt: number): void;
  /** Once per rendered frame, before drawing. */
  update?(dt: number, alpha: number): void;
  /** Queue 3D draws. Omit for a pure 2D game (no 3D pass runs at all). */
  draw3d?(alpha: number): void;
  draw2d?(sb: SpriteBatch, width: number, height: number): void;
}

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly sprites: SpriteBatch;
  readonly physics = new PhysicsWorld();
  readonly world = new World();
  readonly input: Input;
  readonly sfx = new Sfx();
  readonly loop = new FixedLoop(1 / 60);
  /** Built-in meshes plus any loaded models ("model:<name>"). */
  readonly meshes: Record<string, Mesh>;
  camera: Camera = { pos: [0, 8, 14], target: [0, 0, 0], fov: (60 * Math.PI) / 180, near: 0.1, far: 300 };
  /** Run physics.step automatically each fixed step. */
  autoPhysics = true;
  showStats = false;
  time = 0;
  frameMs = 0;
  fps = 0;
  /** Set true in benchmarks: feeds exact 1/60 s per frame. */
  deterministic = false;
  /** Max device pixel ratio; lower it to trade sharpness for fill rate. */
  maxDpr = 2;
  /**
   * Pixel-art mode: draw2d gets the canvas size in device pixels and the
   * canvas uses the full device resolution, so integer camera zoom gives
   * perfectly square, seam-free pixels at any display scaling.
   */
  pixelArt = false;
  /** Device pixels per CSS pixel; multiply UI sizes by this in pixelArt mode. */
  get dpr(): number { return this.canvas.width / Math.max(1, this.canvas.clientWidth); }

  private last = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private running = false;
  private worst = 0;
  private worstShown = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.sprites = new SpriteBatch(this.renderer.gl);
    this.input = new Input(canvas);
    this.meshes = {
      box: this.renderer.createMesh(box()),
      sphere: this.renderer.createMesh(sphere(24, 16)),
      cylinder: this.renderer.createMesh(cylinder(24)),
      gem: this.renderer.createMesh(gem()),
      plane: this.renderer.createMesh(plane(1)),
    };
    addEventListener("keydown", (e) => { if (e.code === "F3") { this.showStats = !this.showStats; e.preventDefault(); } });
    addEventListener("pointerdown", () => this.sfx.unlock());
    addEventListener("keydown", () => this.sfx.unlock());
  }

  run(game: Game): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      const elapsed = this.deterministic ? 1 / 60 : (now - this.last) / 1000;
      this.last = now;
      const t0 = performance.now();
      this.resize();
      let steps = 0;
      const alpha = this.loop.advance(elapsed, (dt) => {
        steps++;
        game.fixedUpdate?.(dt);
        if (this.autoPhysics) this.physics.step(dt);
        this.world.flush();
        this.time += dt;
      });
      game.update?.(Math.min(elapsed, 0.1), alpha);

      const gl = this.renderer.gl;
      const w = this.canvas.width, h = this.canvas.height;
      if (game.draw3d) {
        this.renderer.begin(this.camera);
        game.draw3d(alpha);
        this.renderer.end(this.camera, this.time);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.06, 0.07, 0.09, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      // 2D normally works in CSS pixels. Pixel-art games work in device pixels
      // instead, so one art pixel maps to a whole number of screen pixels.
      const W2 = this.pixelArt ? w : this.canvas.clientWidth, H2 = this.pixelArt ? h : this.canvas.clientHeight;
      if (game.draw2d || this.showStats) {
        this.sprites.resetStats();
        this.sprites.begin(W2, H2);
        if (game.draw2d) {
          game.draw2d(this.sprites, W2, H2);
        }
        if (this.showStats) this.drawStats(W2);
        this.sprites.end();
      }
      this.frameMs = performance.now() - t0;
      this.worst = Math.max(this.worst, this.frameMs);
      this.fpsAcc += elapsed;
      this.fpsN++;
      if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.worstShown = this.worst; this.worst = 0; }
      this.input.endFrame(steps > 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private drawStats(w: number) {
    const sb = this.sprites, R = this.renderer.stats, P = this.physics.stats;
    const lines = [
      `${this.fps.toFixed(0)} fps   cpu ${this.frameMs.toFixed(2)} ms (worst ${this.worstShown.toFixed(1)})`,
      `3d: ${R.draws} draws, ${R.instances} instances, ${R.culled} culled`,
      `2d: ${sb.stats.sprites} sprites, ${sb.stats.draws} draws`,
      `physics: ${this.physics.bodies.length} bodies, ${P.contacts} contacts, ${P.sleeping} asleep`,
      `entities: ${this.world.count}`,
    ];
    const x = w - 330;
    sb.rect(x - 10, 8, 330, lines.length * 18 + 12, 0x000000b0);
    lines.forEach((l, i) => sb.text(l, x, 14 + i * 18, 13, 0xd8f0d8ff));
  }

  resize(): void {
    const dpr = this.pixelArt ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, this.maxDpr);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
}
