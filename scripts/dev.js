import { spawn } from "node:child_process";

const processes = [];

if (process.env.EDGELAB_AUTH_PROVIDER === "better-auth") {
  if (!(await isHttpUp("http://127.0.0.1:3002/health"))) processes.push({ name: "better-auth", command: "node", args: ["backend/auth/server.mjs"] });
  else console.log("[better-auth] already running on http://127.0.0.1:3002");
}

if (!(await isHttpUp("http://127.0.0.1:3001/api/health"))) {
  processes.push({
    name: "node-api",
    command: "node",
    args: ["backend/index.js"],
  });
} else {
  console.log("[node-api] already running on http://127.0.0.1:3001");
}

const pythonApi = await checkHttpService("http://127.0.0.1:8000", [
  "/api/health",
  "/api/app-storage/edgelab/drawing-presets.v1",
  "/api/backtests/latest",
  "/api/playbooks",
]);
if (pythonApi === "down") {
  processes.push({
    name: "python-api",
    command: "backend/.venv/bin/python",
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    env: { ...process.env, PYTHONPATH: "backend" },
  });
} else if (pythonApi === "stale") {
  console.error(
    "[python-api] port 8000 is occupied by an incompatible/stale API. Stop that process and rerun npm run dev.",
  );
  process.exit(1);
} else {
  console.log("[python-api] already running on http://127.0.0.1:8000");
}

processes.push({
  name: "frontend",
  command: "npm",
  args: ["--prefix", "frontend", "run", "dev", "--", "--port", "5173"],
});

const children = processes.map(({ name, command, args, env = process.env }) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(prefix(name, chunk));
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(prefix(name, chunk));
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${name}] exited with ${signal ?? code}`);
    shutdown(code || 1);
  });

  return child;
});

let shuttingDown = false;

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

function prefix(name, chunk) {
  return String(chunk)
    .split("\n")
    .map((line, index, lines) => {
      if (index === lines.length - 1 && line === "") return "";
      return `[${name}] ${line}`;
    })
    .join("\n");
}

async function isHttpUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkHttpService(baseUrl, requiredPaths) {
  const statuses = await Promise.all(
    requiredPaths.map(async (path) => isHttpUp(`${baseUrl}${path}`)),
  );
  if (statuses.every(Boolean)) {
    return "ready";
  }
  if (statuses[0]) {
    return "stale";
  }
  return "down";
}
