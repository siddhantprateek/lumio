// Fast dev launcher: `pnpm start`
// - installs deps only when node_modules is missing or the lockfile changed
// - applies schema.sql only when it changed (or the local DB is missing)
// - starts vite (5173) + wrangler (8787) together
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const sh = process.platform === "win32";
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", shell: sh }).status === 0;
const hash = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");

mkdirSync(".wrangler", { recursive: true });
const stamp = ".wrangler/dev-stamp.json";
let prev = {};
try { prev = JSON.parse(readFileSync(stamp, "utf8")); } catch {}
const cur = { lock: hash("pnpm-lock.yaml"), schema: hash("schema.sql") };

if (!existsSync("node_modules/.bin") || prev.lock !== cur.lock) {
  console.log("[dev] installing dependencies…");
  if (!run("pnpm", ["install", "--prefer-offline"])) process.exit(1);
}

if (prev.schema !== cur.schema || !existsSync(".wrangler/state/v3/d1")) {
  console.log("[dev] applying schema…");
  if (!run("npx", ["wrangler", "d1", "execute", "open-design-db", "--local", "--file=schema.sql"])) process.exit(1);
}
writeFileSync(stamp, JSON.stringify(cur));

console.log("[dev] starting api (8787) + ui (5173)…");
const procs = [
  spawn("npx", ["wrangler", "dev", "--port", "8787"], { stdio: "inherit", shell: sh }),
  spawn("npx", ["vite"], { stdio: "inherit", shell: sh }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", stop));
