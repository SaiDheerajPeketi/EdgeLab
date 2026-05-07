import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const cacheDirs = [
  "frontend/node_modules/.vite",
  "frontend/.vite",
  "node_modules/.vite",
].map((item) => resolve(process.cwd(), item));

for (const cacheDir of cacheDirs) {
  if (!existsSync(cacheDir)) {
    continue;
  }
  rmSync(cacheDir, { force: true, recursive: true });
  console.log(`[vite-cache] purged ${cacheDir}`);
}
