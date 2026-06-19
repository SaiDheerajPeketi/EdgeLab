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
                    sh 'docker compose up -d --build --force-recreate data-populator api frontend'
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
        }
    }
}
