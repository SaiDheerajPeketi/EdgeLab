import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyNames = ["EDGELAB_JWT_SECRET", "EDGELAB_PERSONAL_PROXY_SECRET", "EDGELAB_SECRET_VAULT_KEYS"];

// Never rotate an existing signing/encryption key implicitly: that can strand records.
export function preparePersonalEnvironment(projectRoot) {
  const directory = path.join(projectRoot, ".artifacts", "personal");
  for (const relative of [".artifacts", ".artifacts/personal", ".artifacts/personal/datasets"]) {
    const target = path.join(projectRoot, relative);
    if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isDirectory())) {
      throw new Error("Personal storage must be an ordinary local directory.");
    }
    fs.mkdirSync(target, { recursive: true, mode: relative.endsWith("/datasets") ? 0o755 : 0o700 });
  }
  const envFile = path.join(directory, ".env");
  if (fs.existsSync(envFile) && (fs.lstatSync(envFile).isSymbolicLink() || !fs.statSync(envFile).isFile())) {
    throw new Error("Personal configuration must be an ordinary local file.");
  }
  if (!fs.existsSync(envFile)) {
    const keyring = JSON.stringify({ personal: randomBytes(32).toString("base64url") });
    const values = [
      "# Private personal installation; never commit, upload or share this file.",
      "EDGELAB_PERSONAL_PORT=8081",
      "EDGELAB_JWT_SECRET=" + randomBytes(32).toString("hex"),
      "EDGELAB_PERSONAL_PROXY_SECRET=" + randomBytes(32).toString("hex"),
      "EDGELAB_SECRET_VAULT_KEYS=" + keyring,
      "EDGELAB_PERSONAL_CRYPTO_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT",
      "EDGELAB_PERSONAL_LOOKBACK_DAYS=30",
      "EDGELAB_PERSONAL_REFRESH_SECONDS=300",
      "# Optional free Alpaca account keys for personal IEX history imports:",
      "APCA_API_KEY_ID=",
      "APCA_API_SECRET_KEY=",
      "",
    ].join("\n");
    fs.writeFileSync(envFile, values, { flag: "wx", mode: 0o600 });
  }
  fs.chmodSync(envFile, 0o600);
  const configuration = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/)
    .filter(line => line && !line.startsWith("#") && line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const port = Number(configuration.EDGELAB_PERSONAL_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Personal port must be between 1024 and 65535.");
  for (const name of keyNames.slice(0, 2)) {
    if (!/^[a-f0-9]{64}$/.test(configuration[name] ?? "")) throw new Error("Personal signing/proxy keys are invalid; restore your original private configuration.");
  }
  let keyring;
  try { keyring = JSON.parse(configuration.EDGELAB_SECRET_VAULT_KEYS); } catch {}
  if (!/^[A-Za-z0-9_-]{43}$/.test(keyring?.personal ?? "")) throw new Error("Personal encryption key is invalid; restore your original private configuration.");
  return { envFile, port, configuration };
}

export function personalComposeArguments(envFile, action, arguments_ = []) {
  const prefix = ["compose", "--project-name", "edgelab-personal", "--project-directory", root, "--env-file", envFile, "-f", path.join(root, "docker-compose.personal.yml")];
  if (action === "start") return [...prefix, "up", "-d", "--build"];
  if (action === "stop") return [...prefix, "stop"];
  if (action === "logs") return [...prefix, "logs", "--tail", "100", ...arguments_];
  if (action === "check") return [...prefix, "config", "--quiet"];
  if (action === "feeds") return [...prefix, "exec", "-T", "data-populator", "python", "/app/backend/scripts/import_personal_feeds.py", "--root", "/datasets", ...arguments_];
  throw new Error("Use start, stop, logs, check or feeds.");
}

export function resolveComposeCommand(environment, run = spawnSync) {
  const options = { env: environment, stdio: "ignore" };
  if (run("docker", ["compose", "version"], options).status === 0) return { command: "docker", plugin: true };
  if (run("docker-compose", ["version"], options).status === 0) return { command: "docker-compose", plugin: false };
  throw new Error("Docker Compose is unavailable. Install Compose v2 and start Docker or Colima.");
}

export function main(arguments_ = process.argv.slice(2)) {
  const action = arguments_[0] ?? "start";
  // Validate the action before touching private storage.
  personalComposeArguments(".env", action, arguments_.slice(1));
  const { envFile, port, configuration } = preparePersonalEnvironment(root);
  // Prevent a production .env or exported shell keys from silently replacing personal keys.
  const environment = { ...process.env, ...configuration };
  const compose = resolveComposeCommand(environment);
  const composeArguments = personalComposeArguments(envFile, action, arguments_.slice(1));
  const result = spawnSync(compose.command, compose.plugin ? composeArguments : composeArguments.slice(1), {
    cwd: root, env: environment, stdio: "inherit",
  });
  if (result.error) throw new Error("Docker Compose is unavailable. Start Docker or Colima and retry.");
  if (result.status !== 0) throw new Error("Personal installation command failed; your existing data and keys were preserved.");
  if (action === "start") console.log("Personal EdgeLab: http://localhost:" + port + " — open the local workspace. Crypto history downloads in the background.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
