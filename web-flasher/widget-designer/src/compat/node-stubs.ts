// ─────────────────────────────────────────────────────────────────────────────
// Stubs for Node modules the SDK's render-v2 chain imports but the browser
// never needs to execute.
//
// `render/glyph-atlas.mjs` builds a glyph atlas by shelling out to ImageMagick
// at BUILD time, and it calls promisify(execFile) at module top level — so the
// import fails in a browser even though the Designer never builds an atlas. It
// consumes a prebuilt one and supplies its own rasterized pixels.
//
// Every stub throws with a specific message if it is ever actually called, so a
// future code path that genuinely needs the filesystem or a subprocess fails
// loudly here instead of silently producing a wrong package.
// ─────────────────────────────────────────────────────────────────────────────

function unavailable(name: string): never {
  throw new Error(
    `${name} is not available in the browser. The Designer rasterizes in-page and ` +
      `consumes a prebuilt glyph atlas, so this path should never run here.`,
  );
}

// ── node:child_process ──────────────────────────────────────────────────────
export function execFile(..._args: unknown[]): never { return unavailable("execFile"); }
export function execFileSync(..._args: unknown[]): never { return unavailable("execFileSync"); }
export function spawn(..._args: unknown[]): never { return unavailable("spawn"); }

// ── node:fs/promises ────────────────────────────────────────────────────────
export async function readFile(..._args: unknown[]): Promise<never> { return unavailable("readFile"); }
export async function writeFile(..._args: unknown[]): Promise<never> { return unavailable("writeFile"); }
export async function mkdtemp(..._args: unknown[]): Promise<never> { return unavailable("mkdtemp"); }
export async function rm(..._args: unknown[]): Promise<never> { return unavailable("rm"); }

// ── node:os ─────────────────────────────────────────────────────────────────
export function tmpdir(): string { return "/tmp"; }

// ── node:util ───────────────────────────────────────────────────────────────
/**
 * Real implementation: glyph-atlas.mjs wraps execFile with it at module load,
 * so returning a working wrapper keeps the import side-effect harmless. The
 * wrapped function still throws if invoked.
 */
export function promisify<T extends (...args: any[]) => any>(fn: T) {
  return (...args: any[]) =>
    new Promise((resolve, reject) => {
      try {
        fn(...args, (error: unknown, value: unknown) => (error ? reject(error) : resolve(value)));
      } catch (cause) {
        reject(cause);
      }
    });
}

// ── node:path ───────────────────────────────────────────────────────────────
// Only the pure string helpers are reachable from this chain.
const path = {
  join: (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/gu, "/"),
  resolve: (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/gu, "/"),
  dirname: (value: string) => value.slice(0, Math.max(0, value.lastIndexOf("/"))) || "/",
  basename: (value: string) => value.slice(value.lastIndexOf("/") + 1),
  extname: (value: string) => {
    const base = value.slice(value.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot) : "";
  },
  sep: "/",
};

export { path };
export default path;
