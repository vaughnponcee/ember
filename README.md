# ember

A small game engine for the browser, written in TypeScript on WebGL2 with no dependencies. It has:
- **3D:** shadowed, instanced rendering;
- **2D:** sprites and tilemaps;
- **physics** with tumbling rigid bodies, and an **ECS**;
- **glTF/GLB model import**;
- **an in-browser editor:** scene building, pixel art with frame animation, and scripts attached to objects.

![Crystal Run](docs/screenshot.png)

```bash
npm start            # builds, then serves http://127.0.0.1:8080/web/
npm test             # 56 tests
npm run bench        # physics and ECS benchmarks
npm run exe          # builds dist/ember.exe, the desktop app
```

Needs Node 23.6 or newer, which runs TypeScript directly. Nothing to install.

## Desktop app

`dist/ember.exe` is a single file, built with Node's single-executable feature. Every editor and game file is embedded inside it.

When you run it:
1. It serves those files on a private local port.
2. It opens them in a chromeless Edge or Chrome app window that uses your GPU and runs at your display's refresh rate.
3. Closing the window quits the app.

Projects are real files:
- **Location:** `Documents\ember\scenes\*.json` and `Documents\ember\sprites\*.json`. Set `EMBER_PROJECT` to use another folder.
- **Saving:** the scene autosaves as you edit, and sprites save as you paint.
- **Security:** the file API only answers the app window, which gets a random token in its URL. It refuses any path outside the project folder.

In a normal Chrome or Edge tab, the drive button in the editor connects any folder as the project, using the browser's file-system access. In other browsers, work stays in browser storage; use Export to keep it.

The desktop app renders exactly as fast as the browser version. What it adds is a dedicated window, background-throttling turned off, real files, and no browser tabs or extensions running alongside.

| page | what it is |
|---|---|
| `web/editor.html` | The editor: Scene, Sprites and Scripts tabs |
| `web/index.html` | **Crystal Run**, a 3D collect-a-thon. Add `?stress=1500` to drop 1,500 extra crates |
| `web/platformer.html` | **Moss Ledge**, a 2D platformer. If you draw a sprite named `hero` in the editor, it replaces the player |

## Hub

The home screen (`web/launcher.html`) is where you start:
- **Projects:** a searchable list showing when each was last opened.
- **New project:** a dialog with templates, a preview, a name and the save location:
  - **3D Starter:** a playable scene with scripts;
  - **Empty 3D**;
  - **Physics Playground:** stacks, bouncing balls, and crates you drop with Space;
  - **2D Sprites:** opens straight into the sprite editor.
- **Templates:** the same templates as cards.
- **Learn:** the demos, the script API and editor shortcuts.

In the desktop app each project is a folder, `Documents\ember\<name>\` (`project.json`, `scenes/`, `sprites/`). In a browser, projects live in browser storage.

## The editor

**Scene tab.**
- Add boxes, crates, balls, pillars, crystals and lights, or **import a .glb/.gltf model**.
- Click to select, drag to move (snaps to 0.5), Alt-drag for height.
- Right-drag orbits, Shift+right-drag pans, the wheel zooms.
- The inspector edits mesh, transform, colour, glow, roughness, physics type, mass, bounce, "keep upright", tag, script and point light.
- Undo and redo, duplicate, delete.
- Scenes autosave to the browser and save or open as JSON.
- **Play** (Ctrl+P) runs the scene with physics and scripts. **Stop** restores the layout from before Play.

**Sprites tab.** A pixel-art editor and animator.
- Pencil, eraser, flood fill and colour picker; a palette; mirror drawing.
- A frame strip with onion skin and a **play button** with adjustable fps. Frames can be added, duplicated, reordered, flipped and deleted.
- Named animations over frame ranges, each with its own fps and loop setting, with a live preview.
- Every sprite lives in an asset library, saved to the project folder when one is open. It exports as a PNG sprite sheet or JSON and imports back.

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
  - read/write `position`, `velocity`, `rotation`, `spin`, `scale`, `color`;
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
| `src/physics.ts` | Spheres and oriented boxes that rotate and tumble. Hashed grid broadphase, separating-axis box tests with up to 4 contact points, sequential impulses with angular terms, warm starting, two-axis friction, shock propagation, sleeping, triggers, layers, raycasts. |
| `src/gltf.ts` | glTF 2.0 import (.glb, or .gltf with embedded data). Node transforms are baked in, mirrored nodes keep correct winding, missing normals are computed, and the model is fitted to a unit box. |
| `src/project.ts` | Project storage: the desktop file API, or a browser folder via File System Access. |
| `src/script.ts` | Script runtime: compile, lifecycle, contact dispatch, error isolation. |
| `src/scene.ts` | JSON scene format plus the standard spawn, interpolate and draw systems. |
| `src/assets.ts` | Sprite assets, the library, sprite sheets and the `Animator`. |
| `src/ecs.ts`, `src/loop.ts`, `src/particles.ts`, `src/input.ts`, `src/audio.ts` | Sparse-set ECS; fixed-step loop; particle pool; keyboard, mouse and gamepad; synthesized sound effects. |

## Numbers

Physics step, `npm run bench`, Node 24, one thread. Half spheres and half boxes, dropped as a dense four-layer pile, all rotating:

| bodies | falling | piled up |
|---:|---:|---:|
| 100 | 1.8 ms | 0.9 ms |
| 500 | 5.3 ms | 4.8 ms |
| 1000 | 14.6 ms | 19.7 ms |

Rotation costs a lot. Before boxes could tumble, 1,000 bodies took 2 ms. Box-box contact now runs a 15-axis separating-axis test and solves up to 4 points with angular terms. A few hundred tumbling bodies fit comfortably in a 60 fps frame; a dense 1,000-body pile doesn't yet.

Crystal Run, CPU time per frame (physics, systems and draw submission) in headless Edge:

| scene | bodies | cpu per frame | draw calls |
|---|---:|---:|---:|
| normal | 68 | 0.8 ms | 8 |
| `?stress=500` | 568 | 2.0 ms | 8 |
| `?stress=1500` | 1568 | 3.6 ms | 8 |

The frame budget at 60 fps is 16.7 ms. The headless browser renders on a software GPU, so it can't report a real frame rate. On a normal GPU these scenes are capped by vsync.

## Things that broke on the way

- **The first rotating solver knocked over its own stacks.** Three causes:
  - friction clamped along a tangent that changed between iterations;
  - contact points solved in a fixed order, so the same corner always went first;
  - the final stabilising pass pushed one corner at a time.

  Fixes: two fixed friction axes per contact, alternating solve order, a linear-only stabilising pass, and above all **warm starting** (each contact keeps last step's impulses). Stacks of 8 boxes now stand and sleep.
- **Rotating piles never fell asleep.** A body resting on a sleeping one woke it every step. Now only real impacts wake sleepers. Sleepers act as solid ground, and sleep is judged on smoothed motion.
- **Stacks sank and never slept.** Fixed with bottom-up contact ordering plus a shock-propagation pass.
- **Physics was slower than it needed to be.** The broadphase built string keys and a pair Set every step, and paired the floor with every body. Switching to integer cell hashes, an AABB pre-test, and reporting each pair only from the lowest cell both bodies share made it 2.4 to 2.9 times faster at 1,000 to 2,000 bodies.
- **The renderer allocated per instance per frame.** It built JavaScript arrays and new typed arrays every frame. Now each batch writes into reusable typed arrays, and the whole frame uploads once.
- **Washed-out colours.** Authored colours were lit as linear values, then gamma-corrected again. They're now converted in the shader.
- **Space did two things in the editor.** It toggled Play and was also the jump key in scripts. Play moved to Ctrl+P, and editor shortcuts are off while a game runs.

## Limits

- **Collision shapes are spheres and boxes.** Imported models collide as their bounding box.
- **glTF textures, skinning, animation and compressed meshes are not imported yet.** Models use their material colour.
- **One shadow cascade.**
- **Point lights don't cast shadows.**
- **Scripts run as page code.** They are your own game code, so only open scene files you trust.
- **The exe is unsigned,** so Windows SmartScreen may warn the first time you run it.
