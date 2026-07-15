#!/usr/bin/env node
/**
 * shoot.mjs — headless screenshot + state-dump harness for game-cart.
 *
 * Boots the game to a DETERMINISTIC frame via the dev URL flags
 * (see docs/knowledge/core/dev-flags.md), waits for a few rendered frames,
 * then saves the WebGL canvas as a PNG plus `window.__game.debugSnapshot()`
 * (see docs/knowledge/core/debug-snapshot.md) as JSON, side by side under
 * `.agent/shots/` (git-ignored).
 *
 * Two serving modes:
 *   - `--url <base>`  use an already-running server (e.g. `npm run dev` at
 *     http://localhost:5173). The URL is used verbatim as the base.
 *   - no `--url`      the script serves the built app itself by spawning
 *     `npm run preview` (Vite preview of `dist/`), parsing its printed
 *     localhost URL, and killing the child on exit. Requires a prior
 *     `npm run build` so `dist/` exists.
 *
 * Dev flags are gated: they are only honored in a dev build or when `debug`
 * is present, so this harness ALWAYS appends `debug=1` — a production `dist`
 * served by preview will then honor the overrides.
 *
 * Node built-ins only besides `playwright`.
 */

// URL/URLSearchParams/timers are Node globals; document/window appear only in
// page.evaluate() callbacks that run in the browser context (not Node scope).
/* global URL, URLSearchParams, setTimeout, clearTimeout, document, window */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
// playwright-core is imported dynamically inside main() so `--dry-run` works
// even before `npm i -D playwright-core` (which needs no browser download; it
// drives an installed system Chrome/Edge via `channel`).

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

/** Value flags: CLI name -> URL param name (identical here, kept explicit). */
const VALUE_FLAGS = {
  biome: "biome",
  seed: "seed",
  weather: "weather",
  time: "time",
  kart: "kart",
  quality: "quality",
};

/** Boolean (presence) flags: CLI name -> URL param name. `debug` is forced. */
const BOOL_FLAGS = {
  autostart: "autostart",
  garage: "garage",
  freefly: "freefly",
};

/** Harness-only options (not part of the game URL). */
const OPTION_FLAGS = new Set(["label", "url", "wait", "out", "channel", "executable"]);

const DEFAULTS = {
  label: "shot",
  wait: 1500,
  out: ".agent/shots",
  viewport: { width: 1280, height: 720 },
};

/**
 * Parse process.argv (no dependency). `--flag value` for value/option flags,
 * bare `--flag` for booleans. Unknown flags throw so typos fail loudly.
 */
function parseArgs(argv) {
  const out = { values: {}, bools: {}, options: {}, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === "dry-run") {
      out.dryRun = true;
    } else if (name in VALUE_FLAGS) {
      out.values[name] = requireValue(argv, ++i, arg);
    } else if (OPTION_FLAGS.has(name)) {
      out.options[name] = requireValue(argv, ++i, arg);
    } else if (name in BOOL_FLAGS) {
      out.bools[name] = true;
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  return out;
}

/** Pull the value token following a `--flag`, erroring if it is missing. */
function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`flag ${flag} needs a value`);
  }
  return value;
}

/**
 * Build the target game URL from parsed args. Value flags come first (in a
 * stable order), then boolean flags, then the forced `debug=1`. Example:
 *   --biome tundra --autostart  ->  <base>/?biome=tundra&autostart=1&debug=1
 */
function buildUrl(base, parsed) {
  const params = new URLSearchParams();
  for (const [cli, param] of Object.entries(VALUE_FLAGS)) {
    if (parsed.values[cli] !== undefined) params.set(param, parsed.values[cli]);
  }
  for (const [cli, param] of Object.entries(BOOL_FLAGS)) {
    if (parsed.bools[cli]) params.set(param, "1");
  }
  params.set("debug", "1");
  // Normalize the base so appending `?...` always lands on the app root.
  const root = base.replace(/\/+$/, "");
  return `${root}/?${params.toString()}`;
}

/** Resolve the output png/json paths for a label under the out dir. */
function outputPaths(outDir, label) {
  const dir = resolve(ROOT, outDir);
  return {
    dir,
    png: join(dir, `${label}.png`),
    json: join(dir, `${label}.json`),
  };
}

/**
 * Spawn `npm run preview` and resolve its printed localhost URL. Rejects if
 * `dist/` is missing or no URL is seen before the timeout. Returns the child
 * plus base URL so the caller can kill it in a finally block.
 */
function startPreview() {
  if (!existsSync(join(ROOT, "dist"))) {
    return Promise.reject(
      new Error("dist/ not found — run `npm run build` first, or pass --url <baseUrl>."),
    );
  }
  const child = spawn("npm", ["run", "preview"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectUrl(new Error("timed out waiting for `npm run preview` to print its URL"));
    }, 30000);
    const onData = (buf) => {
      // Vite colorizes the port with ANSI codes (localhost:<esc>4173<esc>/), so
      // strip them before matching the URL.
      const ansi = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
      const clean = String(buf).replace(ansi, "");
      const match = clean.match(/https?:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolveUrl({ child, base: match[0] });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", () => {});
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectUrl(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`\`npm run preview\` exited early (code ${code})`));
    });
  });
}

/**
 * Read the WebGL error and canvas size from page context. Returns
 * `{ gl, width, height }` where `gl` is the numeric getError() result, the
 * string "no-canvas", or "no-context" when the context is already taken (in
 * which case we fall back to a size check by the caller).
 */
function inspectGl(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { gl: "no-canvas", width: 0, height: 0 };
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    // getContext returns null if the context is already held by the renderer;
    // that is expected, so the caller falls back to a non-zero-size check.
    if (!gl) return { gl: "no-context", width: c.width, height: c.height };
    return { gl: gl.getError(), width: c.width, height: c.height };
  });
}

/** True when the GL inspection indicates a healthy canvas/context. */
function glIsHealthy(info) {
  if (info.gl === 0) return true;
  if (info.gl === "no-context") return info.width > 0 && info.height > 0;
  return false;
}

/** Capture the canvas element as a PNG, falling back to a full-page shot. */
async function captureCanvas(page, pngPath) {
  const canvas = page.locator("canvas").first();
  try {
    await canvas.screenshot({ path: pngPath });
    return "canvas";
  } catch {
    await page.screenshot({ path: pngPath, fullPage: true });
    return "full-page";
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const label = parsed.options.label ?? DEFAULTS.label;
  const waitMs = Number(parsed.options.wait ?? DEFAULTS.wait);
  const outDir = parsed.options.out ?? DEFAULTS.out;
  const paths = outputPaths(outDir, label);

  // Dry run: resolve everything we can WITHOUT a browser and print it.
  if (parsed.dryRun) {
    const base = parsed.options.url ?? "http://localhost:<preview-port>";
    const url = buildUrl(base, parsed);
    process.stdout.write(
      [
        "dry-run (no browser launched)",
        `  label: ${label}`,
        `  url:   ${url}`,
        `  png:   ${paths.png}`,
        `  json:  ${paths.json}`,
        parsed.options.url ? "" : "  serve: npm run preview (dist/ required)",
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
    return;
  }

  mkdirSync(paths.dir, { recursive: true });

  let preview = null;
  let browser = null;
  try {
    // Resolve the base URL: explicit --url, or a spawned preview server.
    let base = parsed.options.url;
    if (!base) {
      preview = await startPreview();
      base = preview.base;
    }
    const url = buildUrl(base, parsed);

    const { chromium } = await import("playwright-core");
    // playwright-core ships no bundled browser (keeps CI installs light), so we
    // drive an installed system browser: Google Chrome by default, overridable
    // with --channel (e.g. msedge) or an explicit --executable <path>.
    const launchOpts = { headless: true };
    if (parsed.options.executable) launchOpts.executablePath = parsed.options.executable;
    else launchOpts.channel = parsed.options.channel ?? "chrome";
    browser = await chromium.launch(launchOpts);
    const page = await browser.newPage({ viewport: DEFAULTS.viewport });
    await page.goto(url, { waitUntil: "load" });

    // window.__game is set only after game.start() in main.ts.
    await page.waitForFunction("!!window.__game", null, { timeout: 30000 });
    // Let a few frames render / weather + time settle.
    await page.waitForTimeout(waitMs);

    const gl = await inspectGl(page);
    if (!glIsHealthy(gl)) {
      throw new Error(`GL check failed: ${JSON.stringify(gl)}`);
    }

    const snapshot = await page.evaluate(() => window.__game.debugSnapshot());
    writeFileSync(paths.json, JSON.stringify(snapshot, null, 2) + "\n");
    const shotMode = await captureCanvas(page, paths.png);

    process.stdout.write(
      [
        "shoot: ok",
        `  label:   ${label}`,
        `  url:     ${url}`,
        `  gl:      ${gl.gl} (${gl.width}x${gl.height})`,
        `  capture: ${shotMode}`,
        `  png:     ${paths.png}`,
        `  json:    ${paths.json}`,
      ].join("\n") + "\n",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (preview?.child) preview.child.kill("SIGTERM");
  }
}

main().catch((err) => {
  process.stderr.write(`shoot: FAILED — ${err.message}\n`);
  process.exitCode = 1;
});
