#!/usr/bin/env bash
set -euo pipefail

# Repairs the live deployment shape seen on the Debian/Ubuntu instance:
# - Jenkins runs behind Nginx on localhost:9090
# - EdgeLab frontend container keeps host port 8080
# - Nginx owns public ports 80/443

JENKINS_PORT="${JENKINS_PORT:-9090}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
EDGELAB_DOMAIN="${EDGELAB_DOMAIN:-edgelab.publicvm.com}"
JENKINS_DOMAIN="${JENKINS_DOMAIN:-jenkins.edgelab.publicvm.com}"
ISSUE_CERTS="${ISSUE_CERTS:-0}"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root: sudo bash deployment/repair-live-deployment.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Docker Compose is not installed." >&2
    exit 1
  fi
}

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx ufw
}

stop_manual_jenkins_on_frontend_port() {
  if ! command -v ss >/dev/null 2>&1; then
    return
  fi

  local pids
  pids="$(ss -ltnp "sport = :$FRONTEND_PORT" 2>/dev/null \
    | awk '/jenkins|java/ {print $NF}' \
    | grep -oE 'pid=[0-9]+' \
    | cut -d= -f2 \
    | sort -u || true)"

  while IFS= read -r pid; do
    if [ -n "$pid" ]; then
      echo "Stopping Jenkins process $pid from port $FRONTEND_PORT"
      kill "$pid" 2>/dev/null || true
    fi
  done <<<"$pids"
}

configure_jenkins_port() {
  if ! systemctl list-unit-files jenkins.service --no-legend 2>/dev/null | grep -q '^jenkins\.service'; then
    echo "jenkins.service was not found; skipping Jenkins systemd override."
    stop_manual_jenkins_on_frontend_port
    return
  fi

  systemctl stop jenkins || true
  stop_manual_jenkins_on_frontend_port

  install -d -m 0755 /etc/systemd/system/jenkins.service.d
  cat >/etc/systemd/system/jenkins.service.d/edgelab-port.conf <<EOF
[Service]
Environment="JENKINS_PORT=$JENKINS_PORT"
Environment="JENKINS_LISTEN_ADDRESS=127.0.0.1"
EOF

  if [ -f /etc/default/jenkins ]; then
    cp -a /etc/default/jenkins "/etc/default/jenkins.edgelab-backup.$(date -u +%Y%m%dT%H%M%SZ)"
    if grep -q '^HTTP_PORT=' /etc/default/jenkins; then
      sed -i "s/^HTTP_PORT=.*/HTTP_PORT=$JENKINS_PORT/" /etc/default/jenkins
    else
      printf '\nHTTP_PORT=%s\n' "$JENKINS_PORT" >>/etc/default/jenkins
    fi
    if grep -q '^JENKINS_ARGS=' /etc/default/jenkins; then
      sed -i "s#^JENKINS_ARGS=.*#JENKINS_ARGS=\"--httpPort=$JENKINS_PORT --httpListenAddress=127.0.0.1\"#" /etc/default/jenkins
    else
      printf 'JENKINS_ARGS="--httpPort=%s --httpListenAddress=127.0.0.1"\n' "$JENKINS_PORT" >>/etc/default/jenkins
    fi
  fi

  systemctl daemon-reload
  systemctl enable jenkins
  systemctl restart jenkins
}

write_nginx_site() {
  local name="$1"
  local domain="$2"
  local upstream="$3"

  cat >"/etc/nginx/sites-available/$name" <<EOF
server {
    listen 80;
    server_name $domain;

    location / {
        proxy_pass http://127.0.0.1:$upstream;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90;
    }
}
EOF

  ln -sfn "/etc/nginx/sites-available/$name" "/etc/nginx/sites-enabled/$name"
}

configure_nginx() {
  write_nginx_site edgelab "$EDGELAB_DOMAIN" "$FRONTEND_PORT"
  write_nginx_site jenkins "$JENKINS_DOMAIN" "$JENKINS_PORT"
  nginx -t
  systemctl enable nginx
  systemctl reload nginx || systemctl restart nginx
}

configure_firewall() {
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow OpenSSH || true
  if ufw status | grep -q inactive; then
    echo "UFW is inactive; leaving it inactive after adding rules."
  else
    ufw reload || true
  fi
}

start_edgelab() {
  cd "$REPO_ROOT"
  mkdir -p datasets
  FRONTEND_PORT="$FRONTEND_PORT" compose up -d --build --force-recreate data-populator api frontend
}

issue_certs() {
  if [ "$ISSUE_CERTS" != "1" ]; then
    echo "Skipping Certbot. Re-run with ISSUE_CERTS=1 once DNS points at this instance."
    return
  fi

  certbot --nginx -d "$EDGELAB_DOMAIN"
  certbot --nginx -d "$JENKINS_DOMAIN"
  nginx -t
  systemctl reload nginx
}

main() {
  install_packages
  configure_jenkins_port
  start_edgelab
  configure_nginx
  configure_firewall
  issue_certs

  echo "Deployment repair complete."
  echo "EdgeLab:  http://$EDGELAB_DOMAIN -> 127.0.0.1:$FRONTEND_PORT"
  echo "Jenkins:  http://$JENKINS_DOMAIN -> 127.0.0.1:$JENKINS_PORT"
}

main "$@"
