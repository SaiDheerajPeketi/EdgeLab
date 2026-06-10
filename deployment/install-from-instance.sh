#!/usr/bin/env bash
set -euo pipefail

# Generated from edgelab-instance-snapshot-20260610T091957Z.u9ifSz.
# Source snapshot path on the generating machine:
# /Users/speketi/Projects/EdgeLab/deployment/instance-snapshots/edgelab-instance-snapshot-20260610T091957Z.u9ifSz
#
# Run from this repository root on a fresh Ubuntu host:
#   sudo bash deployment/install-from-instance.sh
#
# The script installs discovered packages and can restore fetched config files.
# It creates timestamped backups before replacing existing config paths.

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root: sudo bash deployment/install-from-instance.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-$REPO_ROOT/deployment/instance-snapshots/edgelab-instance-snapshot-20260610T091957Z.u9ifSz}"
RESTORE_CONFIGS="${RESTORE_CONFIGS:-0}"
RESTORE_APT_SOURCES="${RESTORE_APT_SOURCES:-1}"
ENABLE_SERVICES="${ENABLE_SERVICES:-0}"
INSTALL_NPM_GLOBALS="${INSTALL_NPM_GLOBALS:-0}"
INSTALL_JENKINS_PLUGINS="${INSTALL_JENKINS_PLUGINS:-0}"
INSTALL_JENKINS_WAR="1"

APT_PACKAGES=(
  acl
  apt-transport-https
  ca-certificates
  certbot
  cloud-init
  containerd.io
  curl
  docker-buildx-plugin
  docker-ce
  docker-ce-cli
  docker-compose-plugin
  eatmydata
  fontconfig
  fuse3
  fwupd
  git
  gnupg
  grub-pc
  initramfs-tools
  libeatmydata1
  libwrap0
  linux-base
  linux-oracle
  lsb-release
  ncurses-term
  net-tools
  nfs-common
  nginx
  open-iscsi
  openjdk-17-jre
  openjdk-21-jdk
  openssh-server
  openssh-sftp-server
  python-babel-localedata
  python3-babel
  python3-certbot-nginx
  python3-jinja2
  python3-json-pointer
  python3-jsonpatch
  python3-jsonschema
  python3-markupsafe
  python3-pyrsistent
  python3-serial
  python3-tz
  shim-signed
  software-properties-common
  ssh-import-id
  stress
  ubuntu-minimal
  ubuntu-server
  ubuntu-standard
  ufw
  unified-monitoring-agent
  wlp-agent
)

SNAP_PACKAGES=(
  oracle-cloud-agent
)

NPM_GLOBAL_PACKAGES=()

JENKINS_PLUGINS=()

ENABLED_SERVICES=(
  ModemManager.service
  apparmor.service
  apport.service
  blk-availability.service
  cloud-config.service
  cloud-final.service
  cloud-init-local.service
  cloud-init.service
  console-setup.service
  containerd.service
  cron.service
  dmesg.service
  docker.service
  e2scrub_reap.service
  finalrd.service
  getty@.service
  grub-common.service
  grub-initrd-fallback.service
  iscsid.service
  jenkins.service
  keyboard-setup.service
  lvm2-monitor.service
  multipathd.service
  networkd-dispatcher.service
  nginx.service
  open-iscsi.service
  open-vm-tools.service
  pollinate.service
  rpcbind.service
  rsyslog.service
  secureboot-db.service
  setvtrgb.service
  snap.oracle-cloud-agent.oracle-cloud-agent-updater.service
  snap.oracle-cloud-agent.oracle-cloud-agent.service
  snapd.apparmor.service
  snapd.autoimport.service
  snapd.core-fixup.service
  snapd.recovery-chooser-trigger.service
  snapd.seeded.service
  snapd.service
  snapd.system-shutdown.service
  sysstat.service
  systemd-networkd-wait-online.service
  systemd-networkd.service
  systemd-pstore.service
  systemd-resolved.service
  systemd-timesyncd.service
  ua-reboot-cmds.service
  ubuntu-advantage.service
  udisks2.service
  ufw.service
  unattended-upgrades.service
  unified-monitoring-agent.service
  unified-monitoring-agent_config_downloader.service
  vgauth.service
  wlp-agent-osqueryd.service
)

CONFIG_PATHS=(
  etc/apt
  etc/default
  etc/docker
  etc/environment
  etc/iptables
  etc/logrotate.d
  etc/nginx
  etc/profile
  etc/profile.d
  etc/ssh/sshd_config
  etc/systemd/system
  etc/sysctl.conf
  etc/sysctl.d
  etc/ufw
  etc/crontab
  etc/cron.d
  etc/cron.daily
  etc/cron.hourly
  etc/cron.monthly
  etc/cron.weekly
  etc/letsencrypt/renewal
  etc/letsencrypt/options-ssl-nginx.conf
  etc/letsencrypt/ssl-dhparams.pem
  home/ubuntu/.bashrc
  home/ubuntu/.profile
  home/ubuntu/.jenkins/config.xml
  home/ubuntu/.jenkins/jenkins.model.JenkinsLocationConfiguration.xml
  home/ubuntu/.jenkins/jobs
  home/ubuntu/.ssh/authorized_keys
)


backup_path() {
  local src="$1"
  local rel="${src#/}"
  local backup_root="$2"
  if [ -e "$src" ]; then
    mkdir -p "$backup_root/$(dirname "$rel")"
    cp -a "$src" "$backup_root/$rel"
  fi
}

install_path() {
  local src="$1"
  local dst="$2"
  local backup_root="$3"
  backup_path "$dst" "$backup_root"
  rm -rf "$dst"
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
}

prepare_apt_sources() {
  if [ "$RESTORE_APT_SOURCES" != "1" ] || [ ! -d "$SNAPSHOT_DIR/etc/apt" ]; then
    return
  fi
  local backup_root="/var/backups/edgelab-apt-config-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup_root"
  install_path "$SNAPSHOT_DIR/etc/apt" /etc/apt "$backup_root"
}

install_apt_packages() {
  prepare_apt_sources
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PACKAGES[@]}"
}

install_snap_packages() {
  if [ "${#SNAP_PACKAGES[@]}" -eq 0 ]; then
    return
  fi
  if ! command -v snap >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y snapd
  fi
  for pkg in "${SNAP_PACKAGES[@]}"; do
    snap install "$pkg" || snap refresh "$pkg" || true
  done
}

install_npm_globals() {
  if [ "$INSTALL_NPM_GLOBALS" != "1" ] || [ "${#NPM_GLOBAL_PACKAGES[@]}" -eq 0 ]; then
    return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm globals were discovered, but npm is not available after apt install." >&2
    return
  fi
  npm install -g "${NPM_GLOBAL_PACKAGES[@]}"
}

install_jenkins_war() {
  if [ "$INSTALL_JENKINS_WAR" != "1" ]; then
    return
  fi
  if [ ! -f /opt/jenkins.war ]; then
    curl -fsSL https://get.jenkins.io/war-stable/latest/jenkins.war -o /opt/jenkins.war
    chmod 0644 /opt/jenkins.war
  fi
}

install_jenkins_plugins() {
  if [ "$INSTALL_JENKINS_PLUGINS" != "1" ] || [ "${#JENKINS_PLUGINS[@]}" -eq 0 ]; then
    return
  fi
  if ! command -v jenkins-plugin-cli >/dev/null 2>&1; then
    echo "Jenkins plugins were discovered, but jenkins-plugin-cli is not available." >&2
    return
  fi
  jenkins-plugin-cli --plugins "${JENKINS_PLUGINS[@]}"
}

restore_configs() {
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

  for rel in "${CONFIG_PATHS[@]}"; do
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
}

enable_services() {
  if [ "$ENABLE_SERVICES" != "1" ]; then
    echo "Skipping service enablement. Re-run with ENABLE_SERVICES=1 after reviewing the service list."
    return
  fi
  for unit in "${ENABLED_SERVICES[@]}"; do
    systemctl enable "$unit" || true
  done
}

main() {
  install_apt_packages
  install_snap_packages
  install_npm_globals
  install_jenkins_war
  install_jenkins_plugins
  restore_configs
  enable_services
  echo "Deployment replay finished."
}

main "$@"
