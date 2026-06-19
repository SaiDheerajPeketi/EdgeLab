pipeline {
    agent any

    parameters {
        string(name: 'DEPLOY_DIR', defaultValue: '/home/peketi_20214004/EdgeLab', description: 'Absolute path to the live EdgeLab checkout on the deployment host.')
        string(name: 'DEPLOY_BRANCH', defaultValue: 'feature/edgelab-landing-auth-ui', description: 'Git branch to deploy.')
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

                            if [ ! -d .git ]; then
                                if find . -mindepth 1 -maxdepth 1 | read; then
                                    echo "${DEPLOY_DIR} exists but is not a git checkout. Set DEPLOY_DIR to the real checkout path or move this directory aside." >&2
                                    exit 1
                                fi
                                git clone --branch "${DEPLOY_BRANCH}" "https://${GIT_USERNAME}:${GIT_TOKEN}@${REPO_URL}" .
                                git remote set-url origin "https://${REPO_URL}"
                            fi

                            git remote set-url origin "https://${REPO_URL}"
                            git fetch "https://${GIT_USERNAME}:${GIT_TOKEN}@${REPO_URL}" "${DEPLOY_BRANCH}"
                            git reset --hard FETCH_HEAD
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
