#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import yaml from "js-yaml";

const roots = process.argv.slice(2);
const bundleRoots = roots.length === 0 ? ["docs/knowledge"] : roots;
let bad = 0;

function fail(file, message) {
  console.error(`[okf-lint] [ERROR] ${file}: ${message}`);
  bad = 1;
}

function markdownFiles(root) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(path);
      }
    }
  }
  walk(root);
  return out.sort();
}

function splitFrontmatter(file, text) {
  if (!text.startsWith("---\n")) {
    return null;
  }

  const close = text.indexOf("\n---\n", 4);
  if (close === -1) {
    fail(file, "frontmatter starts with --- but has no closing delimiter");
    return null;
  }

  return {
    body: text.slice(close + 5),
    raw: text.slice(4, close),
  };
}

function parseFrontmatter(file, raw) {
  try {
    const data = yaml.load(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      fail(file, "frontmatter must parse to a YAML mapping");
      return null;
    }
    return data;
  } catch (error) {
    fail(file, `frontmatter YAML is not parseable: ${error.message}`);
    return null;
  }
}

function firstContentLine(body) {
  return body.split("\n").find((line) => line.trim() !== "") ?? "";
}

function checkConcept(file, text) {
  const parts = splitFrontmatter(file, text);
  if (!parts) {
    fail(file, "concept documents must start with YAML frontmatter");
    return;
  }

  const data = parseFrontmatter(file, parts.raw);
  const type = data?.type;
  if (typeof type !== "string" || type.trim() === "") {
    fail(file, "concept frontmatter must contain a non-empty type field");
  }
}

function checkIndex(root, file, text) {
  let body = text;
  const rootIndex = relative(root, file) === "index.md";
  const parts = splitFrontmatter(file, text);
  if (parts) {
    if (!rootIndex) {
      fail(file, "only the bundle-root index.md may declare frontmatter");
    }
    const data = parseFrontmatter(file, parts.raw);
    const keys = Object.keys(data ?? {});
    const allowed = keys.length === 1 && typeof data?.okf_version === "string";
    if (rootIndex && !allowed) {
      fail(file, "root index.md frontmatter may only declare okf_version");
    }
    body = parts.body;
  }

  const first = firstContentLine(body);
  if (!first.startsWith("# ")) {
    fail(file, "index.md must group entries under at least one heading");
  }
}

function checkLog(file, text) {
  if (text.startsWith("---\n")) {
    fail(file, "log.md must not contain frontmatter");
  }

  const dateHeadings = text.match(/^## .+$/gm) ?? [];
  if (dateHeadings.length === 0) {
    fail(file, "log.md must contain at least one date heading");
  }

  for (const heading of dateHeadings) {
    if (!/^## \d{4}-\d{2}-\d{2}$/.test(heading)) {
      fail(file, "log.md date headings must use YYYY-MM-DD");
    }
  }
}

for (const root of bundleRoots) {
  if (!statSync(root).isDirectory()) {
    fail(root, "bundle root is not a directory");
    continue;
  }

  for (const file of markdownFiles(root)) {
    const rel = relative(root, file).split(sep).join("/");
    const base = basename(file);
    const text = readFileSync(file, "utf8");

    if (base === "index.md") {
      checkIndex(root, file, text);
    } else if (base === "log.md") {
      checkLog(file, text);
    } else {
      checkConcept(file, text);
    }

    if (rel === "") {
      fail(file, "concept id cannot be empty");
    }
  }
}

if (bad === 0) {
  console.log(`[okf-lint] [OK] ${bundleRoots.join(", ")}`);
}

process.exit(bad);
