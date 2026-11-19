import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModel, toBase64 } from "../src/gltf.ts";
import { box, signedVolume, STRIDE } from "../src/mesh.ts";

/** Build a real GLB: the engine's unit cube as two nodes (one moved, one mirrored). */
function makeGlb(opts: { mirror?: boolean; noNormals?: boolean; u32?: boolean } = {}): ArrayBuffer {
  const m = box();
  const n = m.vertices.length / STRIDE;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos.set(m.vertices.subarray(i * STRIDE, i * STRIDE + 3), i * 3); nrm.set(m.vertices.subarray(i * STRIDE + 3, i * STRIDE + 6), i * 3); }
  const ind = opts.u32 ? new Uint32Array(m.indices) : new Uint16Array(m.indices);
  const pad = (b: number) => (b + 3) & ~3;
  const parts = [pos, ...(opts.noNormals ? [] : [nrm]), ind];
  const offsets: number[] = [];
  let total = 0;
  for (const p of parts) { offsets.push(total); total += pad(p.byteLength); }
  const bin = new Uint8Array(total);
  parts.forEach((p, i) => bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offsets[i]));
  const views = parts.map((p, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: p.byteLength }));
  const attributes: Record<string, number> = { POSITION: 0 };
  if (!opts.noNormals) attributes.NORMAL = 1;
  const iAcc = opts.noNormals ? 1 : 2;
  const json = {
    asset: { version: "2.0" }, scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, translation: [3, 0, 0] },
      { mesh: 0, scale: opts.mirror ? [-1, 1, 1] : [1, 1, 1] },
    ],
    meshes: [{ primitives: [{ attributes, indices: iAcc, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 1, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: "VEC3" },
      ...(opts.noNormals ? [] : [{ bufferView: 1, componentType: 5126, count: n, type: "VEC3" }]),
      { bufferView: iAcc, componentType: opts.u32 ? 5125 : 5123, count: ind.length, type: "SCALAR" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: total }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad(js.length);
  const jsPadded = new Uint8Array(jl).fill(0x20); jsPadded.set(js); js = jsPadded;
  const out = new Uint8Array(12 + 8 + jl + 8 + total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  dv.setUint32(20 + jl, total, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl);
  return out.buffer;
}

test("GLB: both nodes merged, fitted to a unit box, centred, outward winding", () => {
  const r = parseModel(makeGlb());
  assert.equal(r.triangles, 24);
  // two cubes 3 apart: 4 wide, 1 tall -> fitted width 1, height 0.25
  assert.ok(Math.abs(r.size[0] - 1) < 1e-6 && Math.abs(r.size[1] - 0.25) < 1e-6, `size ${r.size}`);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < r.mesh.vertices.length; i += STRIDE) { min = Math.min(min, r.mesh.vertices[i]); max = Math.max(max, r.mesh.vertices[i]); }
  assert.ok(Math.abs(min + 0.5) < 1e-6 && Math.abs(max - 0.5) < 1e-6);
  assert.ok(signedVolume(r.mesh) > 0, "outward facing");
  // linear 0.5 -> sRGB
  assert.ok(Math.abs(r.color[0] - Math.pow(0.5, 1 / 2.2)) < 1e-9);
});

test("mirrored node keeps outward winding", () => {
  const r = parseModel(makeGlb({ mirror: true }));
  assert.ok(signedVolume(r.mesh) > 0);
});

test("missing normals are computed and point outward", () => {
  const r = parseModel(makeGlb({ noNormals: true }));
  const v = r.mesh.vertices;
  for (let i = 0; i < v.length; i += STRIDE) {
    assert.ok(Math.abs(Math.hypot(v[i + 3], v[i + 4], v[i + 5]) - 1) < 1e-5);
  }
});

test("32-bit indices and .gltf JSON with embedded buffers", () => {
  const glb = new Uint8Array(makeGlb({ u32: true }));
  const r = parseModel(glb.buffer);
  assert.equal(r.triangles, 24);
  // rebuild as .gltf: same JSON, binary as a data URI
  const dv = new DataView(glb.buffer), jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl)));
  const bin = glb.slice(28 + jl).buffer;
  json.buffers[0].uri = "data:application/octet-stream;base64," + toBase64(bin);
  const g = parseModel(new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer);
  assert.equal(g.triangles, 24);
});

test("clear errors for unsupported files", () => {
  assert.throws(() => parseModel(new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression"] })).buffer as ArrayBuffer), /draco/);
  assert.throws(() => parseModel(new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "model.bin", byteLength: 4 }] })).buffer as ArrayBuffer), /external buffer/);
  assert.throws(() => parseModel(new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, nodes: [], scenes: [{ nodes: [] }] })).buffer as ArrayBuffer), /no triangle/);
});
