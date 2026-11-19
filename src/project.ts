/**
 * Project storage: where scenes and sprites live as real files.
 *
 * - In the desktop app, the host exposes a small file API for Documents/ember
 *   (the page receives an access token in its URL).
 * - In Chrome or Edge, you can pick any folder with the File System Access API.
 * - Otherwise there is no project: data stays in browser storage (export to keep).
 *
 * Paths are always relative, e.g. "scenes/level1.json" or "sprites/hero.json".
 */
export interface ProjectStore {
  readonly label: string;
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const TOKEN_KEY = "ember.token";

/** The desktop host's token, from this page's URL or carried over from the launcher. */
export function desktopToken(): string | null {
  const m = /token=([0-9a-f]{32})/.exec(location.hash);
  if (m) { try { sessionStorage.setItem(TOKEN_KEY, m[1]); } catch { /* ignore */ } return m[1]; }
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

class DesktopStore implements ProjectStore {
  readonly label: string;
  private token: string;
  constructor(token: string, label: string) { this.token = token; this.label = label; }
  private req(method: string, api: string, path: string, body?: string) {
    return fetch(`/api/${api}?path=${encodeURIComponent(path)}`, { method, body, headers: { "x-ember-token": this.token } });
  }
  /** Names in a folder; sub-folders end with "/". */
  async list(dir: string) { const r = await this.req("GET", "list", dir); return r.ok ? (await r.json()) as string[] : []; }
  async read(path: string) { const r = await this.req("GET", "file", path); return r.ok ? r.text() : null; }
  async write(path: string, text: string) { const r = await this.req("PUT", "file", path, text); if (!r.ok) throw new Error(`save failed (${r.status})`); }
  async remove(path: string) { await this.req("DELETE", "file", path); }
}

type Dir = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

class FolderStore implements ProjectStore {
  readonly label: string;
  private root: Dir;
  constructor(root: Dir) { this.root = root; this.label = root.name; }
  private async dir(parts: string[], create: boolean): Promise<Dir | null> {
    let d: Dir = this.root;
    for (const p of parts) {
      try { d = (await d.getDirectoryHandle(p, { create })) as Dir; } catch { return null; }
    }
    return d;
  }
  private split(path: string) {
    const parts = path.split("/").filter((p) => p && p !== "." && p !== "..");
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] ?? "" };
  }
  async list(dir: string) {
    const d = await this.dir(dir.split("/").filter(Boolean), false);
    if (!d) return [];
    const out: string[] = [];
    for await (const h of d.values()) if (h.kind === "file") out.push(h.name);
    return out;
  }
  async read(path: string) {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, false);
    try { return d ? await (await (await d.getFileHandle(name)).getFile()).text() : null; } catch { return null; }
  }
  async write(path: string, text: string) {
    const { dirs, name } = this.split(path);
    const d = (await this.dir(dirs, true))!;
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }
  async remove(path: string) {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, false);
    try { await d?.removeEntry(name); } catch { /* already gone */ }
  }
}

/** A view of a store limited to one sub-folder. */
export function scoped(base: ProjectStore, dir: string): ProjectStore {
  const p = (path: string) => `${dir}/${path}`;
  return {
    label: `${base.label}${base.label.includes("\\") ? "\\" : "/"}${dir}`,
    list: (d) => base.list(p(d)),
    read: (f) => base.read(p(f)),
    write: (f, t) => base.write(p(f), t),
    remove: (f) => base.remove(p(f)),
  };
}

let current: ProjectStore | null = null;
const listeners: ((p: ProjectStore | null) => void)[] = [];

export const Project = {
  get store(): ProjectStore | null { return current; },
  onChange(fn: (p: ProjectStore | null) => void): void { listeners.push(fn); },

  /** Connect to the desktop host if this page was opened by it. */
  async detectDesktop(): Promise<boolean> {
    const t = desktopToken();
    if (!t) return false;
    try {
      const r = await fetch("/api/info", { headers: { "x-ember-token": t } });
      if (!r.ok) return false;
      const info = await r.json() as { project: string };
      this.set(new DesktopStore(t, info.project));
      return true;
    } catch { return false; }
  },

  /** Browser: let the user pick a project folder (Chrome and Edge). */
  async pickFolder(): Promise<boolean> {
    const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<Dir> }).showDirectoryPicker;
    if (!picker) throw new Error("This browser can't open folders. Use Chrome or Edge, or the desktop app.");
    const dir = await picker({ mode: "readwrite", id: "ember-project" });
    this.set(new FolderStore(dir));
    return true;
  },

  set(p: ProjectStore | null): void { current = p; for (const l of listeners) l(p); },

  /** Desktop app: the store for one project, i.e. paths under <root>/<name>/. */
  async openDesktopProject(name: string): Promise<boolean> {
    const t = desktopToken();
    if (!t) return false;
    try {
      const r = await fetch("/api/info", { headers: { "x-ember-token": t } });
      if (!r.ok) return false;
      const info = await r.json() as { project: string };
      this.set(scoped(new DesktopStore(t, info.project), name));
      return true;
    } catch { return false; }
  },

  /** Desktop app: the root store that holds every project folder. */
  async desktopRoot(): Promise<ProjectStore | null> {
    const t = desktopToken();
    if (!t) return null;
    try {
      const r = await fetch("/api/info", { headers: { "x-ember-token": t } });
      if (!r.ok) return null;
      return new DesktopStore(t, ((await r.json()) as { project: string }).project);
    } catch { return null; }
  },

  get folderSupported(): boolean { return "showDirectoryPicker" in window; },
};
