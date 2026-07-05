#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "full";

const fullSteps = ["format", "typecheck", "lint", "lint:secrets", "test", "build", "lint:repo"];
const docsGateSteps = ["format", "lint:md", "lint:secrets", "lint:repo"];

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const command = `git ${args.join(" ")}`;
    console.error(`[verify] [ERROR] ${command} failed`);
    process.exit(result.status || 1);
  }
  return result.stdout.trim();
}

function lines(value) {
  return value.split("\n").filter(Boolean);
}

function diffFiles(args) {
  return new Set(lines(git(["diff", "--name-only", ...args])));
}

function addUntracked(files) {
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  for (const file of lines(untracked)) {
    files.add(file);
  }
  return files;
}

function changedFiles() {
  return addUntracked(diffFiles(["HEAD"]));
}

function stagedFiles() {
  return diffFiles(["--cached", "--diff-filter=ACMR", "HEAD"]);
}

function upstreamRef() {
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    allowFailure: true,
  });
  return upstream || "";
}

function defaultRemoteRef() {
  const originHead = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    allowFailure: true,
  });
  return originHead || "origin/main";
}

function zeroSha(value) {
  return /^0+$/.test(value);
}

function pushFilesFromRefs(refs) {
  const files = new Set();
  for (const line of lines(refs)) {
    const [localRef, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || zeroSha(localSha)) {
      continue;
    }

    if (remoteSha && !zeroSha(remoteSha)) {
      for (const file of diffFiles([`${remoteSha}..${localSha}`])) {
        files.add(file);
      }
      continue;
    }

    const base = git(["merge-base", defaultRemoteRef(), localSha], { allowFailure: true });
    const rangeBase = base || `${localSha}^`;
    for (const file of diffFiles([`${rangeBase}..${localSha}`])) {
      files.add(file);
    }
  }
  return files;
}

function pushedFiles() {
  const stdin = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
  if (stdin.trim()) {
    return pushFilesFromRefs(stdin);
  }

  const upstream = upstreamRef();
  if (upstream) {
    return diffFiles([`${upstream}...HEAD`]);
  }
  return diffFiles([`${defaultRemoteRef()}...HEAD`]);
}

function envFiles() {
  if (process.env.VERIFY_BASE_SHA && process.env.VERIFY_HEAD_SHA) {
    return diffFiles([`${process.env.VERIFY_BASE_SHA}..${process.env.VERIFY_HEAD_SHA}`]);
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    if (event.pull_request?.base?.sha && event.pull_request?.head?.sha) {
      return diffFiles([`${event.pull_request.base.sha}..${event.pull_request.head.sha}`]);
    }
    if (event.before && event.after && !zeroSha(event.before)) {
      return diffFiles([`${event.before}..${event.after}`]);
    }
  }

  return changedFiles();
}

function fileSummary(files) {
  if (files.length === 0) {
    return "none";
  }
  const sample = files.slice(0, 8).join(", ");
  const extra = files.length > 8 ? `, +${files.length - 8} more` : "";
  return `${files.length} file(s): ${sample}${extra}`;
}

function isDocsOnly(files) {
  return files.length > 0 && files.every((file) => file.endsWith(".md"));
}

function hasBacklog(files) {
  return files.some((file) => file.startsWith("docs/backlog/"));
}

function changedSteps(files) {
  if (files.length === 0) {
    return ["format", "lint:repo"];
  }

  const docsOnly = isDocsOnly(files);
  const hasSrc = files.some((file) => file.startsWith("src/") || file.startsWith("test/"));
  const hasTooling = files.some(
    (file) =>
      file.startsWith("tools/") ||
      file.startsWith(".githook/") ||
      file === "package.json" ||
      file.startsWith(".github/"),
  );
  const steps = [];
  if (docsOnly) {
    steps.push("format", "lint:md");
  } else {
    steps.push("format", "typecheck", "lint");
  }
  if (hasBacklog(files)) {
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

function publishSteps(files) {
  if (isDocsOnly(files)) {
    const steps = [...docsGateSteps];
    if (hasBacklog(files)) {
      steps.push("backlog:check");
    }
    return [...new Set(steps)];
  }
  return fullSteps;
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
  const files = [...changedFiles()].sort();
  console.log(`[verify] changed files: ${fileSummary(files)}`);
  runSteps("changed gate", changedSteps(files));
} else if (mode === "staged") {
  const files = [...stagedFiles()].sort();
  console.log(`[verify] staged files: ${fileSummary(files)}`);
  if (files.length > 0) {
    runSteps("staged gate", changedSteps(files));
  } else {
    writeLastVerify("npm run verify:staged", "passed");
    console.log("[verify] [OK] staged gate");
  }
} else if (mode === "push") {
  const files = [...pushedFiles()].sort();
  console.log(`[verify] pushed files: ${fileSummary(files)}`);
  runSteps("push gate", publishSteps(files));
} else if (mode === "ci") {
  const files = [...envFiles()].sort();
  console.log(`[verify] ci files: ${fileSummary(files)}`);
  runSteps("ci gate", publishSteps(files));
} else {
  console.error(`[verify] [ERROR] unknown mode: ${mode}`);
  process.exit(1);
}
