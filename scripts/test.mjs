// Run the whole test suite green in one command: `bun run test` (optionally
// `bun run test apps/web packages/api` to scope by path prefix).
//
// Why a runner instead of plain `bun test`: the API/server integration tests each
// install their own hermetic DATABASE_URL and rely on the `@hosted-agents/db`
// connection singleton (`export const db = createDb()`), which reads DATABASE_URL
// once at import. `bun test` runs every test file in ONE process with a shared
// module cache, so the first db-touching file to load locks the connection and the
// rest read a database missing their seeded rows ("Failed query: … from member").
// ES-module singletons are per-process, so the correct isolation for integration
// tests that need different databases is a process per test file. Every test file
// already uses an in-memory or per-file temp SQLite (never the real local.db), so
// running the files as separate processes — even concurrently — is safe.

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ROOTS = ["apps", "packages"];
const CONCURRENCY = 6;

function findTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const filters = process.argv.slice(2);
const allFiles = ROOTS.flatMap((r) => {
  const dir = join(ROOT, r);
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return findTestFiles(dir);
})
  .map((f) => relative(ROOT, f))
  .filter((f) => filters.length === 0 || filters.some((prefix) => f.startsWith(prefix)))
  .sort();

if (allFiles.length === 0) {
  console.error("No test files matched.");
  process.exit(1);
}

function runFile(file) {
  return new Promise((resolve) => {
    const child = spawn("bun", ["test", file], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      // Bun prints " N pass" / " N fail" on stderr; surface the tally per file.
      const pass = Number(output.match(/(\d+) pass/)?.[1] ?? 0);
      const fail = Number(output.match(/(\d+) fail/)?.[1] ?? 0);
      resolve({ file, ok: code === 0, pass, fail, output });
    });
  });
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < allFiles.length) {
    const file = allFiles[cursor++];
    const result = await runFile(file);
    results.push(result);
    const mark = result.ok ? "✓" : "✗";
    console.log(
      `${mark} ${result.file}  (${result.pass} pass${result.fail ? `, ${result.fail} fail` : ""})`,
    );
    if (!result.ok) console.log(result.output.trimEnd());
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, allFiles.length) }, worker));

const totalPass = results.reduce((n, r) => n + r.pass, 0);
const totalFail = results.reduce((n, r) => n + r.fail, 0);
const failedFiles = results.filter((r) => !r.ok);

console.log("\n" + "─".repeat(50));
console.log(`${allFiles.length} files · ${totalPass} pass · ${totalFail} fail`);
if (failedFiles.length > 0) {
  console.log("Failed files:");
  for (const r of failedFiles) console.log(`  ✗ ${r.file}`);
  process.exit(1);
}
console.log("All green.");
