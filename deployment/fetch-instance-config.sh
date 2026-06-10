#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/deployment/instance-snapshots}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/mykey}"
SSH_TARGET="${SSH_TARGET:-ubuntu@150.136.235.179}"
SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)

mkdir -p "$OUTPUT_ROOT"

remote_tar="$(
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d "/tmp/edgelab-instance-snapshot-${stamp}.XXXXXX")"
snapshot_name="$(basename "$work_dir")"
manifest_dir="$work_dir/manifests"
home_dir="$work_dir/home/ubuntu"
root_home_dir="$work_dir/home/root"
etc_dir="$work_dir/etc"

mkdir -p "$manifest_dir" "$home_dir" "$root_home_dir" "$etc_dir"

copy_if_present() {
  src="$1"
  dst="$2"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
}

sudo_copy_if_present() {
  src="$1"
  dst="$2"
  if sudo test -e "$src"; then
    mkdir -p "$(dirname "$dst")"
    sudo cp -a "$src" "$dst"
    sudo chown -R "$(id -u):$(id -g)" "$dst" 2>/dev/null || true
  fi
}

run_manifest() {
  label="$1"
  shift
  "$@" >"$manifest_dir/$label.txt" 2>"$manifest_dir/$label.stderr.txt" || true
}

for file in \
  /home/ubuntu/.bash_history \
  /home/ubuntu/.bashrc \
  /home/ubuntu/.profile \
  /home/ubuntu/.bash_aliases \
  /home/ubuntu/.bash_logout \
  /home/ubuntu/.inputrc \
  /home/ubuntu/.vimrc \
  /home/ubuntu/.gitconfig \
  /home/ubuntu/.npmrc \
  /home/ubuntu/.pypirc \
  /home/ubuntu/.selected_editor
do
  copy_if_present "$file" "$home_dir/${file#/home/ubuntu/}"
done

for dir in \
  /home/ubuntu/.config/systemd \
  /home/ubuntu/.config/pip \
  /home/ubuntu/.config/npm \
  /home/ubuntu/.local/bin
do
  copy_if_present "$dir" "$home_dir/${dir#/home/ubuntu/}"
done

copy_if_present /home/ubuntu/.ssh/config "$home_dir/.ssh/config"
copy_if_present /home/ubuntu/.ssh/authorized_keys "$home_dir/.ssh/authorized_keys"

sudo_copy_if_present /root/.bash_history "$root_home_dir/.bash_history"
sudo_copy_if_present /root/.bashrc "$root_home_dir/.bashrc"
sudo_copy_if_present /root/.profile "$root_home_dir/.profile"

for file in \
  /home/ubuntu/.jenkins/config.xml \
  /home/ubuntu/.jenkins/jenkins.model.JenkinsLocationConfiguration.xml \
  /var/lib/jenkins/config.xml \
  /var/lib/jenkins/jenkins.model.JenkinsLocationConfiguration.xml \
  /var/lib/jenkins/hudson.tasks.Mailer.xml \
  /var/lib/jenkins/org.jenkinsci.plugins.workflow.flow.FlowExecutionList.xml
do
  sudo_copy_if_present "$file" "$work_dir/${file#/}"
done

for jobs_root in /home/ubuntu/.jenkins/jobs /var/lib/jenkins/jobs; do
  if sudo test -d "$jobs_root"; then
    sudo find "$jobs_root" -type f -name config.xml -print | while IFS= read -r file; do
      sudo_copy_if_present "$file" "$work_dir/${file#/}"
    done
  fi
done

run_manifest os-release cat /etc/os-release
run_manifest uname uname -a
run_manifest hostname hostnamectl
run_manifest users getent passwd
run_manifest groups getent group
run_manifest apt-manual apt-mark showmanual
run_manifest dpkg-selections dpkg --get-selections
run_manifest apt-sources find /etc/apt -maxdepth 4 -type f -print
run_manifest snap-list snap list
run_manifest npm-global npm list -g --depth=0
run_manifest node-version node --version
run_manifest npm-version npm --version
run_manifest python3-version python3 --version
run_manifest pip3-freeze python3 -m pip freeze
run_manifest pipx-list pipx list
run_manifest docker-version docker --version
run_manifest docker-compose-version docker compose version
run_manifest jenkins-version java -jar /opt/jenkins.war --version
run_manifest jenkins-plugins sudo find /var/lib/jenkins/plugins -maxdepth 1 -type f \( -name '*.jpi' -o -name '*.hpi' \) -printf '%f\n'
run_manifest systemctl-enabled systemctl list-unit-files --state=enabled --no-pager --no-legend
run_manifest systemctl-running systemctl list-units --type=service --state=running --no-pager --no-legend
run_manifest systemctl-timers systemctl list-timers --all --no-pager --no-legend
run_manifest ufw-status sudo ufw status verbose
run_manifest iptables-save sudo iptables-save
run_manifest crontab-ubuntu crontab -l
run_manifest crontab-root sudo crontab -l
run_manifest listening-ports ss -tulpn
run_manifest mounts findmnt
run_manifest disk-usage df -h
run_manifest recent-etc-files sudo find /etc -xdev -type f -mtime -365 -printf '%TY-%Tm-%Td %TH:%TM %u:%g %m %p\n'
run_manifest home-deployment-files find /home/ubuntu -maxdepth 4 \( -path '/home/ubuntu/.cache' -o -path '/home/ubuntu/.npm' -o -path '/home/ubuntu/node_modules' \) -prune -o -type f -printf '%TY-%Tm-%Td %TH:%TM %u:%g %m %p\n'

sudo tar \
  --ignore-failed-read \
  --warning=no-file-changed \
  --exclude='etc/shadow*' \
  --exclude='etc/gshadow*' \
  --exclude='etc/security/opasswd' \
  --exclude='etc/ssh/*key*' \
  --exclude='etc/ssl/private' \
  --exclude='etc/letsencrypt/archive' \
  --exclude='etc/letsencrypt/live/*/privkey.pem' \
  --exclude='etc/letsencrypt/live/*/fullchain.pem' \
  --exclude='etc/letsencrypt/live/*/chain.pem' \
  --exclude='etc/letsencrypt/live/*/cert.pem' \
  -C / \
  -cf "$work_dir/etc-configs.tar" \
  etc/apt \
  etc/default \
  etc/docker \
  etc/environment \
  etc/fail2ban \
  etc/iptables \
  etc/logrotate.d \
  etc/netfilter-persistent \
  etc/nginx \
  etc/profile \
  etc/profile.d \
  etc/ssh/sshd_config \
  etc/supervisor \
  etc/systemd/system \
  etc/sysctl.conf \
  etc/sysctl.d \
  etc/ufw \
  etc/crontab \
  etc/cron.d \
  etc/cron.daily \
  etc/cron.hourly \
  etc/cron.monthly \
  etc/cron.weekly \
  etc/letsencrypt/renewal \
  etc/letsencrypt/options-ssl-nginx.conf \
  etc/letsencrypt/ssl-dhparams.pem \
  2>"$manifest_dir/etc-configs-tar.stderr.txt" || true

tar -C "$work_dir" -xf "$work_dir/etc-configs.tar" -C "$work_dir" 2>/dev/null || true
rm -f "$work_dir/etc-configs.tar"

cat >"$work_dir/README.txt" <<EOF
Snapshot: $snapshot_name
Captured from: $(hostname -f 2>/dev/null || hostname)
Captured at UTC: $stamp

Sensitive material intentionally excluded:
- /etc/shadow*, /etc/gshadow*, /etc/security/opasswd
- SSH host/user private keys
- TLS private key/certificate material from /etc/ssl/private and /etc/letsencrypt live/archive
- cache and runtime logs
EOF

tar_path="/tmp/${snapshot_name}.tar.gz"
tar -C /tmp -czf "$tar_path" "$snapshot_name"
printf '%s\n' "$tar_path"
REMOTE
)"

snapshot_file="$OUTPUT_ROOT/$(basename "$remote_tar")"
scp "${SSH_OPTS[@]}" "$SSH_TARGET:$remote_tar" "$snapshot_file"

snapshot_dir="$OUTPUT_ROOT/$(basename "$remote_tar" .tar.gz)"
mkdir -p "$snapshot_dir"
tar -xzf "$snapshot_file" -C "$OUTPUT_ROOT"

echo "Fetched snapshot archive: $snapshot_file"
echo "Extracted snapshot dir: $snapshot_dir"
