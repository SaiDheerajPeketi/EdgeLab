import { spawn } from "node:child_process";

const processes = [
  {
    name: "backend",
    command: "node",
    args: ["backend/index.js"],
  },
  {
    name: "frontend",
    command: "npm",
    args: ["--prefix", "frontend", "run", "dev", "--", "--port", "5173"],
  },
];

const children = processes.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
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
