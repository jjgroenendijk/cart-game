#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const mode = process.argv[2] ?? "list";
const allowedDirs = ["concept", "open", "pending-review", "done"];

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function backlogFiles() {
  return git(["ls-files", "docs/backlog/*.md", "docs/backlog/**/*.md"])
    .split("\n")
    .filter(Boolean)
    .sort();
}

function parseFile(file) {
  const match = file.match(/^docs\/backlog\/([^/]+)\/([^/]+)$/);
  const name = basename(file);
  const task = name.match(/^(\d{3})_([a-z0-9][a-z0-9-]*)\.md$/);
  return {
    file,
    dir: match?.[1] ?? "",
    name,
    id: task?.[1] ?? "",
    validName: Boolean(task),
    validDir: Boolean(match && allowedDirs.includes(match[1])),
  };
}

function groupedTasks() {
  const groups = new Map(allowedDirs.map((dir) => [dir, []]));
  for (const file of backlogFiles()) {
    const task = parseFile(file);
    if (groups.has(task.dir)) {
      groups.get(task.dir).push(task);
    }
  }
  return groups;
}

function printList() {
  const groups = groupedTasks();
  console.log("[backlog:list] tracked backlog tasks");
  for (const dir of allowedDirs) {
    const tasks = groups.get(dir).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`${dir}: ${tasks.length}`);
    for (const task of tasks.slice(0, 12)) {
      console.log(`- ${task.name}`);
    }
    if (tasks.length > 12) {
      console.log(`[INFO] ${tasks.length - 12} more omitted`);
    }
  }
}

function printNext() {
  const groups = groupedTasks();
  const open = groups.get("open").sort((a, b) => a.name.localeCompare(b.name));
  const concept = groups.get("concept").sort((a, b) => a.name.localeCompare(b.name));
  console.log("[backlog:next] next tracked backlog task");
  if (open.length) {
    console.log(`open: ${open[0].file}`);
    return;
  }
  if (concept.length) {
    console.log(`concept: ${concept[0].file}`);
    console.log("[INFO] refine concept into full plan before execution.");
    return;
  }
  console.log("none");
}

function checkBacklog() {
  const tasks = backlogFiles().map(parseFile);
  const errors = [];
  const byId = new Map();

  for (const task of tasks) {
    if (!task.validDir) {
      errors.push(`unexpected dir: ${task.file}`);
    }
    if (!task.validName) {
      errors.push(`invalid filename: ${task.file}`);
    }
    if (task.id) {
      byId.set(task.id, [...(byId.get(task.id) ?? []), task.file]);
    }
  }

  for (const [id, files] of [...byId.entries()].sort()) {
    if (files.length > 1) {
      errors.push(`duplicate id ${id}: ${files.join(", ")}`);
    }
  }

  if (errors.length) {
    console.error("[backlog:check] [ERROR] backlog validation failed");
    for (const error of errors.slice(0, 20)) {
      console.error(`- ${error}`);
    }
    if (errors.length > 20) {
      console.error(`[INFO] ${errors.length - 20} more omitted`);
    }
    process.exit(1);
  }

  console.log(`[backlog:check] OK (${tasks.length} tracked tasks)`);
}

if (mode === "list") {
  printList();
} else if (mode === "next") {
  printNext();
} else if (mode === "check") {
  checkBacklog();
} else {
  console.error(`[backlog] [ERROR] unknown mode: ${mode}`);
  process.exit(1);
}
