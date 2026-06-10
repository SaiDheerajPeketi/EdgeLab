#!/usr/bin/env python3
"""Generate an installation and config-restore script from a fetched instance snapshot."""

from __future__ import annotations

import argparse
import os
import re
import shlex
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_SCRIPT = REPO_ROOT / "deployment" / "install-from-instance.sh"

BASE_PACKAGES = {
    "acl",
    "apt-transport-https",
    "ca-certificates",
    "curl",
    "gnupg",
    "lsb-release",
    "software-properties-common",
    "ufw",
}

SKIP_PACKAGES = {
    "accountsservice",
    "adduser",
    "apt",
    "base-files",
    "base-passwd",
    "bash",
    "bsdutils",
    "coreutils",
    "dash",
    "debconf",
    "debianutils",
    "diffutils",
    "dpkg",
    "findutils",
    "gcc-12-base",
    "grep",
    "gzip",
    "hostname",
    "init",
    "libc6",
    "login",
    "mawk",
    "mount",
    "ncurses-base",
    "ncurses-bin",
    "passwd",
    "perl-base",
    "sed",
    "systemd",
    "sysvinit-utils",
    "tar",
    "ubuntu-keyring",
    "util-linux",
}

CONFIG_ROOTS = [
    "etc/apt",
    "etc/default",
    "etc/docker",
    "etc/environment",
    "etc/fail2ban",
    "etc/iptables",
    "etc/logrotate.d",
    "etc/netfilter-persistent",
    "etc/nginx",
    "etc/profile",
    "etc/profile.d",
    "etc/ssh/sshd_config",
    "etc/supervisor",
    "etc/systemd/system",
    "etc/sysctl.conf",
    "etc/sysctl.d",
    "etc/ufw",
    "etc/crontab",
    "etc/cron.d",
    "etc/cron.daily",
    "etc/cron.hourly",
    "etc/cron.monthly",
    "etc/cron.weekly",
    "etc/letsencrypt/renewal",
    "etc/letsencrypt/options-ssl-nginx.conf",
    "etc/letsencrypt/ssl-dhparams.pem",
    "home/ubuntu/.bashrc",
    "home/ubuntu/.profile",
    "home/ubuntu/.bash_aliases",
    "home/ubuntu/.inputrc",
    "home/ubuntu/.vimrc",
    "home/ubuntu/.gitconfig",
    "home/ubuntu/.npmrc",
    "home/ubuntu/.pypirc",
    "home/ubuntu/.selected_editor",
    "home/ubuntu/.config",
    "home/ubuntu/.jenkins/config.xml",
    "home/ubuntu/.jenkins/jenkins.model.JenkinsLocationConfiguration.xml",
    "home/ubuntu/.jenkins/jobs",
    "home/ubuntu/.local/bin",
    "home/ubuntu/.ssh/config",
    "home/ubuntu/.ssh/authorized_keys",
    "var/lib/jenkins/config.xml",
    "var/lib/jenkins/jenkins.model.JenkinsLocationConfiguration.xml",
    "var/lib/jenkins/hudson.tasks.Mailer.xml",
    "var/lib/jenkins/org.jenkinsci.plugins.workflow.flow.FlowExecutionList.xml",
    "var/lib/jenkins/jobs",
]


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(errors="replace").splitlines() if line.strip()]


def apt_packages(snapshot: Path) -> list[str]:
    manual = read_lines(snapshot / "manifests" / "apt-manual.txt")
    packages: set[str] = set(BASE_PACKAGES)
    for line in manual:
        name = line.split()[0]
        if name and name not in SKIP_PACKAGES and not name.endswith(":amd64"):
            packages.add(name)
    return sorted(packages)


def snap_packages(snapshot: Path) -> list[str]:
    lines = read_lines(snapshot / "manifests" / "snap-list.txt")
    packages = []
    for line in lines[1:]:
        parts = line.split()
        if parts and parts[0] not in {"core", "core18", "core20", "core22", "snapd"}:
            packages.append(parts[0])
    return sorted(set(packages))


def npm_packages(snapshot: Path) -> list[str]:
    lines = read_lines(snapshot / "manifests" / "npm-global.txt")
    packages = []
    for line in lines:
        match = re.search(r"[+`][-- ]\s*(@?[^@\s]+(?:/[^@\s]+)?)(?:@[\w.\-+]+)?", line)
        if match and match.group(1) != "npm":
            packages.append(match.group(1))
    return sorted(set(packages))


def enabled_services(snapshot: Path) -> list[str]:
    services = []
    for line in read_lines(snapshot / "manifests" / "systemctl-enabled.txt"):
        unit = line.split()[0]
        if unit.endswith(".service"):
            services.append(unit)
    return sorted(set(services))


def jenkins_plugins(snapshot: Path) -> list[str]:
    plugins = []
    for line in read_lines(snapshot / "manifests" / "jenkins-plugins.txt"):
        name = line.removesuffix(".jpi").removesuffix(".hpi")
        if name:
            plugins.append(name)
    return sorted(set(plugins))


def needs_jenkins_war(snapshot: Path) -> bool:
    unit = snapshot / "etc" / "systemd" / "system" / "jenkins.service"
    return unit.exists() and "/opt/jenkins.war" in unit.read_text(errors="replace")


def relative_config_paths(snapshot: Path) -> list[Path]:
    paths: list[Path] = []
    for root in CONFIG_ROOTS:
        candidate = snapshot / root
        if candidate.exists():
            paths.append(Path(root))
    return paths


def shell_array(name: str, values: list[str]) -> str:
    if not values:
        return f"{name}=()\n"
    body = "\n".join(f"  {shlex.quote(value)}" for value in values)
    return f"{name}=(\n{body}\n)\n"


def render(snapshot: Path) -> str:
    snapshot = snapshot.resolve()
    config_paths = [str(path) for path in relative_config_paths(snapshot)]
    packages = apt_packages(snapshot)
    snaps = snap_packages(snapshot)
    npm_globals = npm_packages(snapshot)
    services = enabled_services(snapshot)
    plugins = jenkins_plugins(snapshot)
    install_jenkins_war = needs_jenkins_war(snapshot)
    snapshot_label = snapshot.name

    return f"""#!/usr/bin/env bash
set -euo pipefail

# Generated from {snapshot_label}.
# Source snapshot path on the generating machine:
# {snapshot}
#
# Run from this repository root on a fresh Ubuntu host:
#   sudo bash deployment/install-from-instance.sh
#
# The script installs discovered packages and can restore fetched config files.
# It creates timestamped backups before replacing existing config paths.

if [ "${{EUID:-$(id -u)}}" -ne 0 ]; then
  echo "Run as root: sudo bash deployment/install-from-instance.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOT_DIR="${{SNAPSHOT_DIR:-$REPO_ROOT/deployment/instance-snapshots/{snapshot_label}}}"
RESTORE_CONFIGS="${{RESTORE_CONFIGS:-0}}"
RESTORE_APT_SOURCES="${{RESTORE_APT_SOURCES:-1}}"
ENABLE_SERVICES="${{ENABLE_SERVICES:-0}}"
INSTALL_NPM_GLOBALS="${{INSTALL_NPM_GLOBALS:-0}}"
INSTALL_JENKINS_PLUGINS="${{INSTALL_JENKINS_PLUGINS:-0}}"
INSTALL_JENKINS_WAR="{int(install_jenkins_war)}"

{shell_array("APT_PACKAGES", packages)}
{shell_array("SNAP_PACKAGES", snaps)}
{shell_array("NPM_GLOBAL_PACKAGES", npm_globals)}
{shell_array("JENKINS_PLUGINS", plugins)}
{shell_array("ENABLED_SERVICES", services)}
{shell_array("CONFIG_PATHS", config_paths)}

backup_path() {{
  local src="$1"
  local rel="${{src#/}}"
  local backup_root="$2"
  if [ -e "$src" ]; then
    mkdir -p "$backup_root/$(dirname "$rel")"
    cp -a "$src" "$backup_root/$rel"
  fi
}}

install_path() {{
  local src="$1"
  local dst="$2"
  local backup_root="$3"
  backup_path "$dst" "$backup_root"
  rm -rf "$dst"
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
}}

prepare_apt_sources() {{
  if [ "$RESTORE_APT_SOURCES" != "1" ] || [ ! -d "$SNAPSHOT_DIR/etc/apt" ]; then
    return
  fi
  local backup_root="/var/backups/edgelab-apt-config-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup_root"
  install_path "$SNAPSHOT_DIR/etc/apt" /etc/apt "$backup_root"
}}

install_apt_packages() {{
  prepare_apt_sources
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${{APT_PACKAGES[@]}}"
}}

install_snap_packages() {{
  if [ "${{#SNAP_PACKAGES[@]}}" -eq 0 ]; then
    return
  fi
  if ! command -v snap >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y snapd
  fi
  for pkg in "${{SNAP_PACKAGES[@]}}"; do
    snap install "$pkg" || snap refresh "$pkg" || true
  done
}}

install_npm_globals() {{
  if [ "$INSTALL_NPM_GLOBALS" != "1" ] || [ "${{#NPM_GLOBAL_PACKAGES[@]}}" -eq 0 ]; then
    return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm globals were discovered, but npm is not available after apt install." >&2
    return
  fi
  npm install -g "${{NPM_GLOBAL_PACKAGES[@]}}"
}}

install_jenkins_war() {{
  if [ "$INSTALL_JENKINS_WAR" != "1" ]; then
    return
  fi
  if [ ! -f /opt/jenkins.war ]; then
    curl -fsSL https://get.jenkins.io/war-stable/latest/jenkins.war -o /opt/jenkins.war
    chmod 0644 /opt/jenkins.war
  fi
}}

install_jenkins_plugins() {{
  if [ "$INSTALL_JENKINS_PLUGINS" != "1" ] || [ "${{#JENKINS_PLUGINS[@]}}" -eq 0 ]; then
    return
  fi
  if ! command -v jenkins-plugin-cli >/dev/null 2>&1; then
    echo "Jenkins plugins were discovered, but jenkins-plugin-cli is not available." >&2
    return
  fi
  jenkins-plugin-cli --plugins "${{JENKINS_PLUGINS[@]}}"
}}

restore_configs() {{
  if [ "$RESTORE_CONFIGS" != "1" ]; then
    echo "Skipping config restore. Re-run with RESTORE_CONFIGS=1 after reviewing $SNAPSHOT_DIR."
    return
  fi
  if [ ! -d "$SNAPSHOT_DIR" ]; then
    echo "Snapshot directory not found: $SNAPSHOT_DIR" >&2
    exit 1
  fi

  backup_root="/var/backups/edgelab-instance-config-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup_root"

  for rel in "${{CONFIG_PATHS[@]}}"; do
    src="$SNAPSHOT_DIR/$rel"
    dst="/$rel"
    if [[ "$rel" == home/ubuntu/* ]]; then
      dst="/$rel"
    fi
    if [ ! -e "$src" ]; then
      continue
    fi
    install_path "$src" "$dst" "$backup_root"
  done

  if id ubuntu >/dev/null 2>&1 && [ -d /home/ubuntu ]; then
    chown -R ubuntu:ubuntu /home/ubuntu/.bashrc /home/ubuntu/.profile /home/ubuntu/.bash_aliases /home/ubuntu/.config /home/ubuntu/.jenkins /home/ubuntu/.local /home/ubuntu/.ssh 2>/dev/null || true
  fi

  systemctl daemon-reload || true
  nginx -t || true
  echo "Config restore complete. Backups are in $backup_root"
}}

enable_services() {{
  if [ "$ENABLE_SERVICES" != "1" ]; then
    echo "Skipping service enablement. Re-run with ENABLE_SERVICES=1 after reviewing the service list."
    return
  fi
  for unit in "${{ENABLED_SERVICES[@]}}"; do
    systemctl enable "$unit" || true
  done
}}

main() {{
  install_apt_packages
  install_snap_packages
  install_npm_globals
  install_jenkins_war
  install_jenkins_plugins
  restore_configs
  enable_services
  echo "Deployment replay finished."
}}

main "$@"
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path, help="Path to an extracted deployment/instance-snapshots directory")
    parser.add_argument("--output", type=Path, default=OUTPUT_SCRIPT)
    args = parser.parse_args()

    snapshot = args.snapshot
    if not snapshot.exists():
        raise SystemExit(f"Snapshot does not exist: {snapshot}")
    if not (snapshot / "manifests").exists():
        raise SystemExit(f"Snapshot is missing manifests directory: {snapshot}")

    output = args.output
    output.write_text(render(snapshot))
    os.chmod(output, 0o755)
    print(output)


if __name__ == "__main__":
    main()
