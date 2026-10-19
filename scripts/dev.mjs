import { spawn } from "node:child_process";
import path from "node:path";

console.log("\x1b[36m%s\x1b[0m", "🚀 [1/2] Starting PHP Backend on http://127.0.0.1:8000 ...");

const php = spawn(
  "php",
  [
    "-d", "extension=curl",
    "-d", "extension=openssl",
    "-S", "127.0.0.1:8000",
    "backend/server.php",
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

php.stdout.on("data", (data) => {
  const line = data.toString().trim();
  if (line) console.log(`\x1b[35m[php]\x1b[0m ${line}`);
});

php.stderr.on("data", (data) => {
  const line = data.toString().trim();
  if (line && !line.includes("Accepted") && !line.includes("Closing")) {
    console.log(`\x1b[35m[php]\x1b[0m ${line}`);
  }
});

php.on("error", (err) => {
  console.error("\x1b[31m%s\x1b[0m", `[php:error] Failed to start PHP server: ${err.message}`);
});

console.log("\x1b[32m%s\x1b[0m", "⚡ [2/2] Starting Next.js Dev Server on http://localhost:3000 ...");

const nextBin = path.resolve("node_modules/next/dist/bin/next");
const next = spawn(process.execPath, [nextBin, "dev"], {
  stdio: "inherit",
});

next.on("error", (err) => {
  console.error("\x1b[31m%s\x1b[0m", `[next:error] Failed to start Next.js: ${err.message}`);
});

const cleanup = () => {
  try {
    if (php && !php.killed) php.kill();
  } catch {}
  try {
    if (next && !next.killed) next.kill();
  } catch {}
  process.exit();
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
