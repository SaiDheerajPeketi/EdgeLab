import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { personalComposeArguments, preparePersonalEnvironment, resolveComposeCommand } from "../../scripts/personal.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-personal-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test("personal keys are private, independent, stable and outside source inputs", t => {
  const root = fixture(t);
  const first = preparePersonalEnvironment(root);
  const second = preparePersonalEnvironment(root);
  assert.deepEqual(second.configuration, first.configuration);
  assert.equal(first.port, 8081);
  assert.notEqual(first.configuration.EDGELAB_JWT_SECRET, first.configuration.EDGELAB_PERSONAL_PROXY_SECRET);
  assert.equal(Buffer.from(JSON.parse(first.configuration.EDGELAB_SECRET_VAULT_KEYS).personal, "base64url").length, 32);
  assert.equal(fs.statSync(first.envFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(first.envFile)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(path.dirname(first.envFile), "datasets")).mode & 0o777, 0o755);
  assert.notEqual(preparePersonalEnvironment(fixture(t)).configuration.EDGELAB_JWT_SECRET, first.configuration.EDGELAB_JWT_SECRET);
});
test("invalid saved keys fail without rotation or touching records", t => {
  const root = fixture(t), state = preparePersonalEnvironment(root);
  const broken = fs.readFileSync(state.envFile, "utf8").replace(state.configuration.EDGELAB_JWT_SECRET, "bad-key");
  fs.writeFileSync(state.envFile, broken);
  assert.throws(() => preparePersonalEnvironment(root), /invalid/);
  assert.equal(fs.readFileSync(state.envFile, "utf8"), broken);
});
test("personal state refuses a redirected private directory or file", t => {
  const root = fixture(t), elsewhere = fixture(t);
  fs.mkdirSync(path.join(root, ".artifacts"));
  fs.symlinkSync(elsewhere, path.join(root, ".artifacts", "personal"));
  assert.throws(() => preparePersonalEnvironment(root), /ordinary local directory/);
  const otherRoot = fixture(t), state = preparePersonalEnvironment(otherRoot);
  fs.unlinkSync(state.envFile);
  fs.writeFileSync(path.join(elsewhere, "keys"), "secret");
  fs.symlinkSync(path.join(elsewhere, "keys"), state.envFile);
  assert.throws(() => preparePersonalEnvironment(otherRoot), /ordinary local file/);
});
test("compose commands select only personal services and stop retains volumes", () => {
  const start = personalComposeArguments("/private/.env", "start");
  assert.ok(start.includes("docker-compose.personal.yml") || start.some(value => value.endsWith("/docker-compose.personal.yml")));
  assert.deepEqual(start.slice(0, 3), ["compose", "--project-name", "edgelab-personal"]);
  assert.deepEqual(start.slice(-3), ["up", "-d", "--build"]);
  assert.equal(personalComposeArguments("/private/.env", "stop").at(-1), "stop");
  assert.ok(!personalComposeArguments("/private/.env", "stop").includes("--volumes"));
  assert.deepEqual(personalComposeArguments("/private/.env", "feeds", ["--provider", "kraken"]).slice(-9),
    ["exec", "-T", "data-populator", "python", "/app/backend/scripts/import_personal_feeds.py", "--root", "/datasets", "--provider", "kraken"]);
  assert.throws(() => personalComposeArguments("x", "down"), /Use start/);
});

test("supports Compose v2 plugin or standalone without invoking a shell", () => {
  const calls = [], run = (command, arguments_) => {
    calls.push([command, arguments_]);
    return { status: command === "docker-compose" ? 0 : 1 };
  };
  assert.deepEqual(resolveComposeCommand({}, run), { command: "docker-compose", plugin: false });
  assert.deepEqual(calls, [["docker", ["compose", "version"]], ["docker-compose", ["version"]]]);
  assert.deepEqual(resolveComposeCommand({}, () => ({ status: 0 })), { command: "docker", plugin: true });
  assert.throws(() => resolveComposeCommand({}, () => ({ status: null })), /Compose is unavailable/);
});
