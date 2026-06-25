pipeline {
    agent any

    parameters {
        string(name: 'DEPLOY_DIR', defaultValue: '/home/peketi_20214004/EdgeLab', description: 'Absolute path to the live EdgeLab checkout on the deployment host.')
    }

    environment {
        REPO_URL = 'github.com/SaiDheerajPeketi/EdgeLab.git'
    }

    triggers {
        githubPush()
    }

    stages {
        stage('Pull') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'github-token',
                    usernameVariable: 'GIT_USERNAME',
                    passwordVariable: 'GIT_TOKEN'
                )]) {
                    dir(params.DEPLOY_DIR) {
                        sh '''#!/usr/bin/env bash
                            set -euo pipefail

                            auth_repo_url="https://${GIT_USERNAME}:${GIT_TOKEN}@${REPO_URL}"
                            public_repo_url="https://${REPO_URL}"
                            target_commit="${GIT_COMMIT:-}"
                            target_branch="${BRANCH_NAME:-${GIT_BRANCH:-}}"
                            target_branch="${target_branch#origin/}"
                            deploy_dir="$(pwd)"

                            if ! git config --global --get-all safe.directory | grep -Fxq "${deploy_dir}"; then
                                git config --global --add safe.directory "${deploy_dir}"
                            fi

                            if [ ! -d .git ]; then
                                if find . -mindepth 1 -maxdepth 1 | read; then
                                    echo "$(pwd) exists but is not a git checkout. Set DEPLOY_DIR to the real checkout path or move this directory aside." >&2
                                    exit 1
                                fi
                                git clone "${auth_repo_url}" .
                                git remote set-url origin "${public_repo_url}"
                            fi

                            git remote set-url origin "${public_repo_url}"
                            git fetch "${auth_repo_url}" '+refs/heads/*:refs/remotes/origin/*'

                            if [ -n "${target_commit}" ] && git cat-file -e "${target_commit}^{commit}" 2>/dev/null; then
                                git reset --hard "${target_commit}"
                            elif [ -n "${target_branch}" ] && git show-ref --verify --quiet "refs/remotes/origin/${target_branch}"; then
                                git reset --hard "refs/remotes/origin/${target_branch}"
                            elif git show-ref --verify --quiet refs/remotes/origin/main; then
                                git reset --hard refs/remotes/origin/main
                            else
                                git reset --hard refs/remotes/origin/master
                            fi
                        '''
                    }
                }
            }
        }

        stage('Prepare') {
            steps {
                dir(params.DEPLOY_DIR) {
                    sh 'mkdir -p datasets'
                }
            }
        }

        stage('Deploy') {
            steps {
                dir(params.DEPLOY_DIR) {
                    sh '''#!/usr/bin/env bash
                        set -euo pipefail

                        if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
                            compose_cmd="docker compose"
                        else
                            compose_cmd="docker-compose"
                        fi

                        export COMPOSE_PARALLEL_LIMIT=1
                        export DOCKER_BUILDKIT=0
                        export COMPOSE_DOCKER_CLI_BUILD=0

                        ${compose_cmd} down --remove-orphans
                        ${compose_cmd} build --no-cache \
                          pgbouncer-postgres \
                          pgbouncer-timescaledb \
                          api \
                          market-api \
                          analytics-worker \
                          data-populator \
                          frontend
                        ${compose_cmd} up -d --remove-orphans
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'Deployment successful!'
        }
        failure {
            echo 'Deployment failed!'
            dir(params.DEPLOY_DIR) {
                sh '''#!/usr/bin/env bash
                    set +e

                    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
                        compose_cmd="docker compose"
                    elif command -v docker-compose >/dev/null 2>&1; then
                        compose_cmd="docker-compose"
                    else
                        echo "Docker Compose is unavailable; cannot dump container logs." >&2
                        exit 0
                    fi

                    ${compose_cmd} ps
                    ${compose_cmd} logs --tail=200 postgres timescaledb pgbouncer-postgres pgbouncer-timescaledb redis api market-api analytics-worker data-populator frontend
                '''
            }
        }
    }
}
