#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

const mode = process.argv[2] ?? "ctx";
const backlogDirs = ["concept", "open", "pending-review", "done"];
const statePath = ".agent/state.json";

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      ...options,
    }).trim();
  } catch {
    return "";
  }
}

function git(args) {
  return run("git", args);
}

function capLines(value, limit) {
  const lines = value.split("\n").filter(Boolean);
  const shown = lines.slice(0, limit);
  if (lines.length > limit) {
    shown.push(`[INFO] ${lines.length - limit} more omitted`);
  }
  return shown;
}

function trackedBacklogFiles() {
  const files = git(["ls-files", "docs/backlog/*.md", "docs/backlog/**/*.md"]);
  return files.split("\n").filter(Boolean).sort();
}

function changedFiles() {
  const values = new Set();
  const tracked = git(["diff", "--name-only", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  for (const file of [...tracked.split("\n"), ...untracked.split("\n")]) {
    if (file) {
      values.add(file);
    }
  }
  return [...values].sort();
}

function stagedFiles() {
  return git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
}

function backlogSummary() {
  const tracked = trackedBacklogFiles();
  const byDir = new Map(backlogDirs.map((dir) => [dir, []]));
  for (const file of tracked) {
    const match = file.match(/^docs\/backlog\/([^/]+)\/([^/]+)$/);
    if (match && byDir.has(match[1])) {
      byDir.get(match[1]).push(match[2]);
    }
  }

  return backlogDirs.map((dir) => {
    const files = byDir.get(dir).sort();
    const names = files.slice(0, 5).join(", ") || "none";
    const extra = files.length > 5 ? `, +${files.length - 5} more` : "";
    return `- ${dir}: ${files.length} (${names}${extra})`;
  });
}

function branchInfo() {
  const branch = git(["branch", "--show-current"]) || "(detached)";
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return { branch, upstream: upstream || "none" };
}

function worktreeSummary() {
  const status = git(["status", "--short"]);
  const staged = stagedFiles().length;
  const changed = changedFiles().length;
  if (!status) {
    return "clean";
  }
  return `dirty (${staged} staged, ${changed} changed/untracked)`;
}

function subsystemFor(file) {
  if (file.startsWith("src/")) {
    return "src";
  }
  if (file.startsWith("docs/backlog/")) {
    return "backlog";
  }
  if (file.startsWith("docs/")) {
    return "docs";
  }
  if (file.startsWith(".githook/")) {
    return "hooks";
  }
  if (file.startsWith(".github/")) {
    return "github";
  }
  if (file.startsWith("tools/") || file === "package.json") {
    return "tooling";
  }
  if (file === "AGENTS.md" || file.endsWith("/AGENTS.md")) {
    return "agent-docs";
  }
  return "other";
}

function changedSummary() {
  const files = changedFiles();
  const bySubsystem = new Map();
  for (const file of files) {
    const key = subsystemFor(file);
    bySubsystem.set(key, [...(bySubsystem.get(key) ?? []), file]);
  }

  const lines = [];
  for (const [name, group] of [...bySubsystem.entries()].sort()) {
    const sample = group.slice(0, 5).join(", ");
    const extra = group.length > 5 ? `, +${group.length - 5} more` : "";
    lines.push(`- ${name}: ${group.length} (${sample}${extra})`);
  }
  return { files, lines: lines.length ? lines : ["- none: 0"] };
}

function suggestedChecks(files) {
  if (files.length === 0) {
    return ["npm run agent:ctx"];
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

  const checks = [];
  if (docsOnly) {
    checks.push("npm run format", "npm run lint:md");
  } else {
    checks.push("npm run verify:changed");
  }
  if (hasBacklog) {
    checks.push("npm run backlog:check");
  }
  if (hasSrc) {
    checks.push("npm run typecheck", "npm run lint:eslint", "npm run test");
  }
  if (hasTooling) {
    checks.push("npm run lint:repo");
  }
  return [...new Set(checks)];
}

function currentBacklogItem(branch, files) {
  const fromBranch = branch.match(/(?:^|[-_/])(\d{3})(?:[-_/]|$)/)?.[1];
  if (fromBranch) {
    return fromBranch;
  }

  const ids = new Set();
  for (const file of files) {
    const match = basename(file).match(/^(\d{3})_/);
    if (file.startsWith("docs/backlog/") && match) {
      ids.add(match[1]);
    }
  }
  if (ids.size === 1) {
    return [...ids][0];
  }
  if (ids.size > 1) {
    return `multiple: ${[...ids].sort().join(", ")}`;
  }
  return "unknown";
}

function lastVerify() {
  const path = ".agent/last-verify.json";
  if (!existsSync(path)) {
    return { command: "none", result: "unknown" };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { command: "unknown", result: "unreadable" };
  }
}

function hasGh() {
  return Boolean(run("gh", ["--version"]));
}

function prUrl() {
  if (!hasGh()) {
    return "";
  }
  return run("gh", ["pr", "view", "--json", "url", "--jq", ".url"]);
}

function renderCtx() {
  const { branch, upstream } = branchInfo();
  const { files } = changedSummary();
  const recent = capLines(git(["log", "--oneline", "-5"]), 5);
  const changed = capLines(files.join("\n"), 20);

  return [
    "[agent:ctx] repo context",
    `branch: ${branch}`,
    `upstream: ${upstream}`,
    `worktree: ${worktreeSummary()}`,
    "changed files:",
    ...(changed.length ? changed.map((line) => `- ${line}`) : ["- none"]),
    "recent commits:",
    ...(recent.length ? recent.map((line) => `- ${line}`) : ["- none"]),
    "backlog:",
    ...backlogSummary(),
    "next commands:",
    "- npm run agent:changed",
    "- npm run backlog:check",
    "- npm run verify:changed",
  ].join("\n");
}

function renderChanged() {
  const { files, lines } = changedSummary();
  return [
    "[agent:changed] changed-file summary",
    ...lines,
    "suggested checks:",
    ...suggestedChecks(files).map((check) => `- ${check}`),
  ].join("\n");
}

function renderState() {
  const { branch, upstream } = branchInfo();
  const { files, lines } = changedSummary();
  const state = {
    branch,
    upstream,
    backlogItem: currentBacklogItem(branch, files),
    lastVerify: lastVerify(),
    lastChangedSummary: lines,
    lastPrUrl: prUrl() || "unknown",
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return [
    "[agent:state] wrote .agent/state.json",
    `branch: ${state.branch}`,
    `backlog item: ${state.backlogItem}`,
    `last verify: ${state.lastVerify.command} -> ${state.lastVerify.result}`,
    `last PR: ${state.lastPrUrl}`,
  ].join("\n");
}

function renderHandoff() {
  return [
    "[agent:handoff] compact subagent prompt",
    "",
    "Use provided compact context first. Avoid broad repo discovery unless needed.",
    "Do not dump raw logs. Return concise summary only.",
    "",
    "Task:",
    "<TASK: replace with exact scope>",
    "",
    "Context:",
    renderCtx(),
    "",
    "Changed summary:",
    renderChanged(),
    "",
    "Repo reminders:",
    "- backlog source truth: docs/backlog/ status dirs",
    "- no committed media/binary assets by default",
    "- keep hand-written files <=600 lines and lines <=100 chars",
    "- use capped command output; cite log path for full failure logs",
    "",
    "Return format:",
    "- files changed",
    "- commands run",
    "- failures/fixes",
    "- remaining risks",
  ].join("\n");
}

function renderPr() {
  if (!hasGh()) {
    return "[agent:pr] gh unavailable; skipping PR status.";
  }

  const view = spawnSync(
    "gh",
    ["pr", "view", "--json", "url,state,number,title,headRefName,baseRefName"],
    { encoding: "utf8" },
  );
  if (view.status !== 0) {
    return "[agent:pr] no PR found for current branch.";
  }

  const pr = JSON.parse(view.stdout);
  const checks = spawnSync("gh", ["pr", "checks", "--json", "name,state,conclusion"], {
    encoding: "utf8",
  });
  let checkLines = ["checks: unavailable"];
  if (checks.status === 0 && checks.stdout.trim()) {
    const parsed = JSON.parse(checks.stdout);
    const failing = parsed.filter(
      (check) =>
        check.conclusion &&
        !["success", "skipped", "neutral"].includes(String(check.conclusion).toLowerCase()),
    );
    const pending = parsed.filter((check) => String(check.state).toLowerCase() !== "completed");
    checkLines = [
      `checks: ${parsed.length} total, ${failing.length} failing, ${pending.length} pending`,
      ...(failing.length ? ["failing:", ...failing.map((check) => `- ${check.name}`)] : []),
    ];
  }

  return [
    "[agent:pr] PR status",
    `branch: ${pr.headRefName} -> ${pr.baseRefName}`,
    `PR: #${pr.number} ${pr.state} ${pr.url}`,
    `title: ${pr.title}`,
    ...checkLines,
  ].join("\n");
}

if (mode === "ctx") {
  console.log(renderCtx());
} else if (mode === "changed") {
  console.log(renderChanged());
} else if (mode === "state") {
  console.log(renderState());
} else if (mode === "handoff") {
  console.log(renderHandoff());
} else if (mode === "pr") {
  console.log(renderPr());
} else {
  console.error(`[agent] [ERROR] unknown mode: ${mode}`);
  process.exit(1);
}
