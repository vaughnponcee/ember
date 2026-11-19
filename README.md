# ember

A small game engine for the browser, written in TypeScript on WebGL2 with no dependencies. It has:
- **3D:** shadowed, instanced rendering;
- **2D:** sprites and tilemaps;
- **physics** and an **ECS**;
- **an in-browser editor:** scene building, pixel art with frame animation, and scripts attached to objects.

![Crystal Run](docs/screenshot.png)

```bash
npm start            # builds, then serves http://127.0.0.1:8080/web/
npm test             # 46 tests
npm run bench        # physics and ECS benchmarks
```

Needs Node 23.6 or newer, which runs TypeScript directly. Nothing to install.

| page | what it is |
|---|---|
| `web/editor.html` | The editor: Scene, Sprites and Scripts tabs |
| `web/index.html` | **Crystal Run**, a 3D collect-a-thon. Add `?stress=1500` to drop 1,500 extra crates |
| `web/platformer.html` | **Moss Ledge**, a 2D platformer. If you draw a sprite named `hero` in the editor, it replaces the player |

## The editor

**Scene tab.**
- Add boxes, crates, balls, pillars, crystals and lights.
- Click to select, drag to move (snaps to 0.5), Alt-drag for height.
- Right-drag orbits, Shift+right-drag pans, the wheel zooms.
- The inspector edits mesh, transform, colour, glow, roughness, physics type, mass, bounce, tag, script and point light.
- Undo and redo, duplicate, delete.
- Scenes autosave to the browser and save or open as JSON.
- **Play** (Ctrl+P) runs the scene with physics and scripts. **Stop** restores the layout from before Play.

**Sprites tab.** A pixel-art editor and animator.
- Pencil, eraser, flood fill and colour picker; a palette; mirror drawing.
- A frame strip with onion skin. Frames can be added, duplicated, reordered, flipped and deleted.
- Named animations over frame ranges, each with its own fps and loop setting, with a live preview.
- Every sprite lives in an asset library. It exports as a PNG sprite sheet or JSON and imports back.

**Scripts tab.** Behaviour attached to objects, the way Unity attaches C# components.
- Scripts are JavaScript, edited in the page with a live syntax check.
- Errors that happen at runtime show in a console under the viewport. They name the script and object, and stop only that script.

```js
// attached to the player
function start(self, game) {
  game.state.score = 0;
  game.follow(self, 9, 4);                 // third-person camera
}

function update(self, game, dt) {
  const m = game.input.axes();
  self.velocity = [m.x * 6, self.velocity[1], -m.y * 6];
  if (game.input.pressed("Space") && self.grounded) game.sound.jump(), self.push([0, 9, 0]);
  game.print("Score: " + game.state.score);
}

function onTrigger(self, other, game) {
  if (other.tag === "coin") { other.destroy(); game.state.score++; }
}
```

**Script API**
- **Hooks:** `start`, `update`, `onTrigger`, `onCollide`, `onDestroy`.
- **`self` and `other`:**
  - read/write `position`, `velocity`, `rotation`, `scale`, `color`;
  - read `grounded`, `name`, `tag`;
  - per-object `state`;
  - `push()`, `destroy()`, `distanceTo()`.
- **`game`:**
  - `input`, `sound`, `camera`, `time`;
  - shared `state`;
  - `find(name)`, `findAll(tag)`, `spawn(obj, script)`, `raycast()`, `follow()`;
  - `print()` and `log()`.

## Using the engine from code

```ts
import { Engine } from "./src/engine.ts";
import { spawnScene, savePrevious, syncAndDraw } from "./src/scene.ts";
import { ScriptRuntime } from "./src/script.ts";

const eng = new Engine(canvas);                     // renderer, 2D batch, physics, ECS, input, audio, 60 Hz loop
spawnScene(sceneJson, eng.world, eng.physics, eng.renderer, eng.meshes);
eng.run({
  fixedUpdate(dt) { savePrevious(eng.world); },
  draw3d(alpha) { syncAndDraw(eng.world, eng.renderer, alpha); },
  draw2d(sb, w, h) { sb.text("HUD", 16, 16, 20); },
});
```

F3 shows a live performance overlay in any game built on `Engine`.

| module | what it does |
|---|---|
| `src/renderer.ts` | Instanced WebGL2 forward renderer. All instances go into one buffer upload per frame, with one draw per mesh per pass. Sun with a 2048² PCF shadow map, hemisphere ambient, 8 point lights, height fog, ACES tonemapping, sky, frustum culling. |
| `src/sprites.ts` | Instanced 2D sprite batch: rotation, pivot, tint, flip. Generated font atlas for text, 2D camera with shake. |
| `src/tilemap.ts` | Tile grid with solid and one-way tiles, drop-through, and platformer collision that never tunnels. Only the tiles in view are drawn. |
| `src/physics.ts` | Spheres and boxes. Hashed grid broadphase, impulse contacts with friction, shock propagation for stacks, sleeping, triggers, layers, raycasts. |
| `src/script.ts` | Script runtime: compile, lifecycle, contact dispatch, error isolation. |
| `src/scene.ts` | JSON scene format plus the standard spawn, interpolate and draw systems. |
| `src/assets.ts` | Sprite assets, the library, sprite sheets and the `Animator`. |
| `src/ecs.ts`, `src/loop.ts`, `src/particles.ts`, `src/input.ts`, `src/audio.ts` | Sparse-set ECS; fixed-step loop; particle pool; keyboard, mouse and gamepad; synthesized sound effects. |

## Numbers

Physics step, `npm run bench`, Node 24, one thread:

| bodies | falling | settled |
|---:|---:|---:|
| 500 | 0.97 ms | 0.46 ms |
| 1000 | 2.03 ms | 1.22 ms |
| 2000 | 4.08 ms | 2.84 ms |

Crystal Run, CPU time per frame (physics, systems and draw submission) in headless Edge:

| scene | bodies | cpu per frame | draw calls |
|---|---:|---:|---:|
| normal | 68 | 0.8 ms | 8 |
| `?stress=500` | 568 | 2.0 ms | 8 |
| `?stress=1500` | 1568 | 3.6 ms | 8 |

The frame budget at 60 fps is 16.7 ms. The headless browser renders on a software GPU, so it can't report a real frame rate. On a normal GPU these scenes are capped by vsync.

## Things that broke on the way

- **Stacks sank and never slept.** Fixed with bottom-up contact ordering plus a shock-propagation pass.
- **Physics was slower than it needed to be.** The broadphase built string keys and a pair Set every step, and paired the floor with every body. Switching to integer cell hashes, an AABB pre-test, and reporting each pair only from the lowest cell both bodies share made it 2.4 to 2.9 times faster at 1,000 to 2,000 bodies.
- **The renderer allocated per instance per frame.** It built JavaScript arrays and new typed arrays every frame. Now each batch writes into reusable typed arrays, and the whole frame uploads once.
- **Washed-out colours.** Authored colours were lit as linear values, then gamma-corrected again. They're now converted in the shader.
- **Space did two things in the editor.** It toggled Play and was also the jump key in scripts. Play moved to Ctrl+P, and editor shortcuts are off while a game runs.

## Limits

- **3D bodies don't rotate,** so there is no tumbling.
- **One shadow cascade.**
- **Point lights don't cast shadows.**
- **No model import yet,** only procedural meshes. glTF is next.
- **Scripts run as page code.** They are your own game code, so only open scene files you trust.
- **The asset library lives in this browser's storage.** Export sprites and scenes to keep them.
