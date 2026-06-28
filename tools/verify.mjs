#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "full";

const fullSteps = ["format", "typecheck", "lint", "lint:secrets", "test", "build", "lint:repo"];

function changedFiles() {
  const tracked = spawnSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return new Set([
    ...tracked.stdout.split("\n").filter(Boolean),
    ...untracked.stdout.split("\n").filter(Boolean),
  ]);
}

function changedSteps() {
  const files = [...changedFiles()];
  if (files.length === 0) {
    return ["format", "lint:repo"];
  }

  const docsOnly = files.every((file) => file.endsWith(".md"));
  const hasSrc = files.some((file) => file.startsWith("src/") || file.startsWith("test/"));
  const hasTooling = files.some(
    (file) =>
      file.startsWith("tools/") ||
      file.startsWith(".githook/") ||
      file === "package.json" ||
      file.startsWith(".github/"),
  );
  const hasBacklog = files.some((file) => file.startsWith("docs/backlog/"));

  const steps = [];
  if (docsOnly) {
    steps.push("format", "lint:md");
  } else {
    steps.push("format", "typecheck", "lint");
  }
  if (hasBacklog) {
    steps.push("backlog:check");
  }
  if (hasSrc) {
    steps.push("test");
  }
  if (hasTooling) {
    steps.push("lint:repo");
  }
  if (!docsOnly) {
    steps.push("lint:secrets");
  }
  return [...new Set(steps)];
}

function safeName(step) {
  return step.replace(/[^a-z0-9._-]+/gi, "-");
}

function writeLastVerify(command, result) {
  mkdirSync(".agent", { recursive: true });
  writeFileSync(
    ".agent/last-verify.json",
    `${JSON.stringify({ command, result, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function runStep(step) {
  console.log(`[verify] ${step}`);
  const result = spawnSync("npm", ["run", "-s", step], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status === 0) {
    console.log(`[verify] [OK] ${step}`);
    return;
  }

  mkdirSync(".agent/logs", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = `.agent/logs/${stamp}-${safeName(step)}.log`;
  writeFileSync(logPath, `${result.stdout}${result.stderr}`);
  console.error(`[verify] [ERROR] ${step} failed`);
  console.error(`[verify] command: npm run ${step}`);
  console.error(`[verify] log: ${logPath}`);
  writeLastVerify(`npm run ${step}`, "failed");
  process.exit(result.status || 1);
}

function runSteps(label, steps) {
  console.log(`[verify] ${label}: ${steps.join(" -> ")}`);
  for (const step of steps) {
    runStep(step);
  }
  writeLastVerify(`npm run verify${mode === "full" ? "" : `:${mode}`}`, "passed");
  console.log(`[verify] [OK] ${label}`);
}

if (mode === "full") {
  runSteps("full gate", fullSteps);
} else if (mode === "changed") {
  runSteps("changed gate", changedSteps());
} else if (mode === "push") {
  // Push gate intentionally uses full local CI parity. It is slower, but
  // shared branches should not receive commits that only passed a cheap subset.
  runSteps("push gate", fullSteps);
} else {
  console.error(`[verify] [ERROR] unknown mode: ${mode}`);
  process.exit(1);
}
