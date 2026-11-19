/**
 * ember hub: the home screen. Lists projects, creates new ones from templates,
 * and links to demos and docs. In the desktop app projects are folders under
 * Documents/ember; in a browser they live in browser storage.
 */
import { hydrateIcons, icon } from "./icons.ts";
import { TEMPLATES, templateScene, type Template } from "./templates.ts";
import { Project, desktopToken, type ProjectStore } from "../src/project.ts";

hydrateIcons();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hash = location.hash; // carries the desktop token to other pages

interface ProjectInfo { name: string; template: string; opened: number; created: number }

let root: ProjectStore | null = null;
let projects: ProjectInfo[] = [];

const LIST_KEY = "ember.projects";
const local = (): ProjectInfo[] => { try { return JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]"); } catch { return []; } };
const saveLocal = (l: ProjectInfo[]) => { try { localStorage.setItem(LIST_KEY, JSON.stringify(l)); } catch { /* ignore */ } };

async function loadProjects() {
  const byName = new Map(local().map((p) => [p.name, p]));
  if (root) {
    // every folder with a project.json is a project; folders win over the browser list
    for (const entry of await root.list(".")) {
      if (!entry.endsWith("/")) continue;
      const name = entry.slice(0, -1);
      const txt = await root.read(`${name}/project.json`);
      if (!txt) continue;
      try { const meta = JSON.parse(txt) as ProjectInfo; byName.set(name, { ...meta, ...(byName.get(name) ?? {}), name }); } catch { /* skip */ }
    }
  }
  projects = [...byName.values()].sort((a, b) => b.opened - a.opened);
  renderProjects();
}

function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const tplOf = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
const tplIcon = (t: Template) => (t.kind === "2D" ? "image" : t.id === "physics" ? "package" : t.id === "empty" ? "box" : "gem");

function openProject(p: ProjectInfo) {
  const t = tplOf(p.template);
  const tab = t.tab && t.tab !== "scene" ? `&tab=${t.tab}` : "";
  location.href = `editor.html?project=${encodeURIComponent(p.name)}&template=${t.id}${tab}${hash}`;
}

function renderProjects() {
  const q = $<HTMLInputElement>("q").value.trim().toLowerCase();
  const rows = $("rows");
  rows.innerHTML = "";
  const shown = projects.filter((p) => p.name.toLowerCase().includes(q));
  for (const p of shown) {
    const t = tplOf(p.template);
    const tr = document.createElement("tr");
    tr.className = "proj";
    tr.innerHTML = `<td><div class="nm"><span class="ic">${icon(tplIcon(t), 17)}</span><span class="n"></span></div></td><td class="m"></td><td class="m"></td><td class="m" style="text-align:right"><button class="rm" title="${root ? "Remove from this list (files are kept)" : "Delete project"}">${icon("trash-2", 15)}</button></td>`;
    tr.querySelector(".n")!.textContent = p.name;
    tr.children[1].textContent = `${t.name} · ${t.kind}`;
    tr.children[2].textContent = ago(p.opened);
    tr.onclick = (e) => { if (!(e.target as HTMLElement).closest(".rm")) openProject(p); };
    (tr.querySelector(".rm") as HTMLButtonElement).onclick = () => {
      if (!confirm(root ? `Remove "${p.name}" from the list? Its folder stays on disk.` : `Delete "${p.name}"? Its scene is removed from this browser.`)) return;
      saveLocal(local().filter((x) => x.name !== p.name));
      if (!root) { try { localStorage.removeItem(`ember.project.${p.name}.scene`); } catch { /* ignore */ } }
      projects = projects.filter((x) => x !== p);
      renderProjects();
    };
    rows.appendChild(tr);
  }
  $("none").style.display = shown.length ? "none" : "block";
  (document.querySelector("table") as HTMLElement).style.display = shown.length ? "table" : "none";
}

// ---- views ----------------------------------------------------------------------
document.querySelectorAll<HTMLButtonElement>("nav [data-view]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav [data-view]").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + b.dataset.view));
}));
document.querySelectorAll<HTMLAnchorElement>("a[data-page]").forEach((a) => (a.href = a.dataset.page + hash));
$("q").oninput = renderProjects;

const tcards = $("tcards");
for (const t of TEMPLATES) {
  const b = document.createElement("button");
  b.className = "card";
  b.innerHTML = `<div class="art k${t.kind}">${icon(tplIcon(t), 34)}</div><div class="tx"><b></b><span></span></div>`;
  b.querySelector("b")!.textContent = t.name;
  b.querySelector("span")!.textContent = t.blurb;
  b.onclick = () => openDialog(t.id);
  tcards.appendChild(b);
}

// ---- new project dialog --------------------------------------------------------------
let chosen = TEMPLATES[0], cat = "all";
function renderTemplates() {
  const list = $("tlist");
  list.innerHTML = "";
  for (const t of TEMPLATES.filter((t) => cat === "all" || t.kind === cat)) {
    const b = document.createElement("button");
    b.className = "tpl" + (t === chosen ? " on" : "");
    b.innerHTML = `<span class="ic art k${t.kind}">${icon(tplIcon(t), 20)}</span><div><b></b><span>${t.kind}</span></div>`;
    b.querySelector("b")!.textContent = t.name;
    b.onclick = () => { chosen = t; renderTemplates(); };
    b.ondblclick = () => { chosen = t; void create(); };
    list.appendChild(b);
  }
  $("pv-art").className = `art k${chosen.kind}`;
  $("pv-art").innerHTML = icon(tplIcon(chosen), 54);
  $("pv-name").textContent = chosen.name;
  $("pv-blurb").textContent = chosen.blurb;
}
document.querySelectorAll<HTMLButtonElement>("#cats [data-cat]").forEach((b) => (b.onclick = () => {
  cat = b.dataset.cat!;
  document.querySelectorAll("#cats [data-cat]").forEach((x) => x.classList.toggle("on", x === b));
  renderTemplates();
}));

function uniqueName(base: string) {
  let n = 1, name = base;
  while (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${base} ${++n}`;
  return name;
}

function openDialog(templateId?: string) {
  chosen = TEMPLATES.find((t) => t.id === templateId) ?? chosen;
  $<HTMLInputElement>("pname").value = uniqueName("My project");
  $("perr").textContent = "";
  $("ploc").textContent = location_();
  renderTemplates();
  $("modal").classList.add("on");
  setTimeout(() => { const i = $<HTMLInputElement>("pname"); i.focus(); i.select(); }, 0);
}
const closeDialog = () => $("modal").classList.remove("on");
$("new").onclick = () => openDialog();
$("cancel").onclick = closeDialog;
$("modal").onclick = (e) => { if (e.target === $("modal")) closeDialog(); };
addEventListener("keydown", (e) => {
  if (!$("modal").classList.contains("on")) return;
  if (e.key === "Escape") closeDialog();
  if (e.key === "Enter") void create();
});
$("pname").oninput = () => { $("ploc").textContent = location_(); $("perr").textContent = ""; };

function location_() {
  const n = $<HTMLInputElement>("pname").value.trim() || "...";
  return root ? `${root.label}${root.label.includes("\\") ? "\\" : "/"}${n}` : "This browser (export scenes to keep them)";
}

async function create() {
  const name = $<HTMLInputElement>("pname").value.trim();
  if (!name) { $("perr").textContent = "Give the project a name."; return; }
  if (!/^[\w .-]+$/.test(name)) { $("perr").textContent = "Use letters, numbers, spaces, dots, dashes or underscores."; return; }
  if (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) { $("perr").textContent = "A project with that name already exists."; return; }
  const info: ProjectInfo = { name, template: chosen.id, opened: Date.now(), created: Date.now() };
  const scene = templateScene(chosen.id, name);
  try {
    if (root) {
      await root.write(`${name}/project.json`, JSON.stringify(info, null, 1));
      await root.write(`${name}/scenes/main.json`, JSON.stringify(scene, null, 1));
    }
    localStorage.setItem(`ember.project.${name}.scene`, JSON.stringify(scene));
  } catch (e) { $("perr").textContent = "Could not create: " + (e as Error).message; return; }
  saveLocal([...local().filter((p) => p.name !== name), info]);
  openProject(info);
}

// ---- start -------------------------------------------------------------------------------
(async () => {
  root = desktopToken() ? await Project.desktopRoot() : null;
  $("where").innerHTML = root ? `<b>Projects folder</b>` : `<b>Browser storage</b>Use the desktop app to keep projects as files.`;
  if (root) $("where").append(root.label);
  $("ploc").textContent = location_();
  await loadProjects();
})();
(window as unknown as { hub: unknown }).hub = { openDialog, create, get projects() { return projects; } };
