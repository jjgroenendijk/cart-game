#!/usr/bin/env node
/**
 * Visual verify runner. Drives the `?scene=` bookmark URLs (commit 1) through
 * headless Chromium, captures a deterministic still per scene, downsamples it
 * to a Signature, and either writes a baseline (capture) or compares against
 * the on-disk baseline (check).
 *
 * Usage:
 *   node tools/visual/run.mjs check            compare scenes.json vs baselines
 *   node tools/visual/run.mjs capture          write/refresh baselines
 *   node tools/visual/run.mjs check temperate  filter scenes by id substring
 *
 * Env:
 *   VISUAL_SKIP_BUILD=1  skip the `vite build` step (use a prebuilt dist/).
 *
 * Screenshots land under .agent/visual/ (gitignored). Baselines land under
 * tools/visual/baselines/ and are owned by a later commit. Chromium absence is
 * a graceful skip (exit 0) so CI does not fail before browsers are installed.
 *
 * Determinism notes (load-bearing; see commit 4 runbook before changing):
 *  - Scene mode FREEZES src-side after settle (Game.frameScene): before settle
 *    it advances time/animation one tick per frame; AT/AFTER settle it passes
 *    dt=0 and holds this.time constant, so every post-settle frame is
 *    byte-identical. window.__sceneReady fires on the first frozen frame and is
 *    the runner's SOLE readiness signal; the runner captures any time after it
 *    with zero timing sensitivity.
 *  - Capture path: the SIGNATURE is read from window.__captureStill (Game's
 *    scene-mode hook), which renders the frozen scene ONCE then gl.readPixels
 *    in the same JS task -> deterministic, bypasses the Playwright
 *    element.screenshot SwiftShader recomposite (which varied 55-103 RGB
 *    within-session). A viewable PNG artifact is ALSO saved via compositor
 *    screenshot (human eyeballing only; NOT used for the signature).
 *  - Measured determinism: readPixels-direct is byte-identical BOTH within a
 *    browser session AND across separate browser processes (13/13 scenes, 0
 *    delta), because software GL is CPU-rasterized and arch-stable. The
 *    default tolerance is therefore strict (per-cell 30, 0 cells over). A
 *    real look change moves dozens of the 576 cells and fails cleanly; see
 *    commit 4 runbook before relaxing tolerance.
 */
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  signatureFromRgba,
  stringifySignature,
  parseSignature,
  compareSignatures,
} from "./signature.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SCENES_PATH = resolve(__dirname, "scenes.json");
const BASELINES_DIR = resolve(__dirname, "baselines");
const OUT_DIR = resolve(ROOT, ".agent", "visual");
const VIEWPORT = { width: 960, height: 540 };
const SETTLE_MS = 300;
const LAUNCH_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

function findFreePort(start) {
  return new Promise((resolvePort, reject) => {
    let port = start;
    const attempt = () => {
      if (port > start + 100) {
        reject(new Error("no free port found"));
        return;
      }
      const probe = net.createServer();
      probe.unref();
      probe.on("error", () => {
        port += 1;
        attempt();
      });
      probe.listen(port, () => {
        const held = probe.address().port;
        probe.close(() => resolvePort(held));
      });
    };
    attempt();
  });
}

function isUp(base) {
  return new Promise((done) => {
    const req = http.get(base, (res) => {
      res.resume();
      done(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => done(false));
    req.setTimeout(2000, () => {
      req.destroy();
      done(false);
    });
  });
}

async function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(base)) return;
    await sleep(250);
  }
  throw new Error(`preview server not ready at ${base}`);
}

async function teardownPreview(preview) {
  if (!preview || !preview.pid) return;
  let exited = false;
  preview.once("exit", () => {
    exited = true;
  });
  try {
    preview.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 30; i += 1) {
    if (exited) return;
    await sleep(100);
  }
  try {
    preview.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

function isAllZero(sig) {
  return sig.rows.every((run) => /^[0-9a-f]+$/.test(run) && !run.replace(/0/g, ""));
}

/** Capture one scene on a fresh page of the shared context. */
async function tryScene(ctx, base, scene, mode) {
  const page = await ctx.newPage();
  try {
    const url = `${base}/?scene=${encodeURIComponent(scene.scene)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction("window.__sceneReady === true", { timeout: 30000 });
    await page.waitForTimeout(SETTLE_MS);
    const shot = await page.evaluate("window.__captureStill()");
    const rgba = Uint8Array.from(Buffer.from(shot.rgbaB64, "base64"));
    const sig = signatureFromRgba(rgba, shot.width, shot.height);
    if (isAllZero(sig)) {
      return { ok: false, error: "blank capture (all-zero grid)" };
    }
    mkdirSync(OUT_DIR, { recursive: true });
    const pngBuf = await page.locator("canvas").first().screenshot({ type: "png" });
    writeFileSync(resolve(OUT_DIR, `${scene.id}.png`), pngBuf);
    if (mode === "capture") {
      mkdirSync(BASELINES_DIR, { recursive: true });
      writeFileSync(resolve(BASELINES_DIR, `${scene.id}.json`), stringifySignature(sig));
      return { ok: true, result: { id: scene.id, pass: true, mode: "capture" } };
    }
    const baselinePath = resolve(BASELINES_DIR, `${scene.id}.json`);
    if (!existsSync(baselinePath)) {
      return {
        ok: true,
        result: {
          id: scene.id,
          pass: false,
          error: "no baseline; run `npm run visual:capture`",
        },
      };
    }
    const baseline = parseSignature(readFileSync(baselinePath, "utf8"));
    const cmp = compareSignatures(sig, baseline);
    return {
      ok: true,
      result: {
        id: scene.id,
        pass: cmp.pass,
        maxCellDelta: cmp.maxCellDelta,
        cellsOverTol: cmp.cellsOverTol,
        meanCellDelta: cmp.meanCellDelta,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await page.close();
  }
}

async function runScene(ctx, base, scene, mode) {
  const first = await tryScene(ctx, base, scene, mode);
  if (first.ok) return first.result;
  console.log(`[visual] retrying ${scene.id} (first attempt: ${first.error})`);
  const retry = await tryScene(ctx, base, scene, mode);
  if (retry.ok) return retry.result;
  return { id: scene.id, pass: false, error: retry.error };
}

async function main() {
  const mode = process.argv[2] === "capture" ? "capture" : "check";
  const filter = process.argv[3];
  const scenes = JSON.parse(readFileSync(SCENES_PATH, "utf8"));
  const selected = filter ? scenes.filter((s) => s.id.includes(filter)) : scenes;
  if (selected.length === 0) {
    console.error(`[visual] no scenes match filter: ${filter}`);
    return 1;
  }

  if (process.env.VISUAL_SKIP_BUILD !== "1") {
    console.log("[visual] building dist/...");
    const build = spawnSync("npx", ["vite", "build"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (build.status !== 0) {
      console.error("[visual] vite build failed; aborting");
      return build.status ?? 1;
    }
  }

  const port = await findFreePort(4173);
  const preview = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const base = `http://localhost:${port}`;
  let exitCode = 0;

  try {
    await waitForServer(base, 30000);
    console.log(`[visual] preview at ${base} (mode=${mode}, ${selected.length} scenes)`);

    let browser;
    try {
      browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    } catch (err) {
      console.error(
        "[visual] chromium not installed; run `npx playwright install chromium`. Skipping.",
      );
      console.error(`[visual] (${err.message})`);
      return 0;
    }

    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const results = [];
    for (const scene of selected) {
      const result = await runScene(ctx, base, scene, mode);
      results.push(result);
      if (mode === "capture") {
        console.log(`[visual] wrote baseline: ${scene.id}`);
      } else {
        const tag = result.pass ? "PASS" : "FAIL";
        const detail =
          result.error ??
          `maxDelta=${result.maxCellDelta?.toFixed(2)}, over=${result.cellsOverTol}`;
        console.log(`[visual] [${tag}] ${scene.id} (${detail})`);
      }
    }
    await ctx.close();
    await browser.close();

    if (mode === "check") {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(resolve(OUT_DIR, "report.json"), `${JSON.stringify({ results }, null, 2)}\n`);
      const failed = results.filter((r) => !r.pass);
      if (failed.length > 0) {
        console.error(`[visual] ${failed.length}/${results.length} scenes FAILED`);
        exitCode = 1;
      } else {
        console.log(`[visual] all ${results.length} scenes passed`);
      }
    } else {
      console.log(`[visual] captured ${results.length} baselines`);
    }
  } catch (err) {
    console.error(`[visual] error: ${err.message}`);
    exitCode = 1;
  } finally {
    await teardownPreview(preview);
  }
  return exitCode;
}

main().then((code) => process.exit(code));
