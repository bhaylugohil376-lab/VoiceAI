import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ignored = new Set(["node_modules", ".git", ".vercel"]);
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) walk(join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(join(dir, entry.name));
    }
  }
}
walk(process.cwd());
let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write("FAIL " + relative(process.cwd(), file) + "\n");
    process.stderr.write(result.stderr || result.stdout || "Syntax check failed.\n");
  }
}
if (failed) process.exit(1);
console.log("Syntax check passed for " + files.length + " JavaScript files.");
