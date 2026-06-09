pipeline {
    agent any

    triggers {
        githubPush()
    }

    stages {
        stage('Pull') {
            steps {
                dir('/home/ubuntu/EdgeLab') {
                    withCredentials([usernamePassword(
                        credentialsId: 'github-token',
                        usernameVariable: 'GIT_USERNAME',
                        passwordVariable: 'GIT_TOKEN'
                    )]) {
                        sh '''
                            git fetch https://${GIT_USERNAME}:${GIT_TOKEN}@github.com/SaiDheerajPeketi/EdgeLab.git master
                            git reset --hard FETCH_HEAD
                        '''
                    }
                }
            }
        }

        stage('Prepare') {
            steps {
                dir('/home/ubuntu/EdgeLab') {
                    sh 'mkdir -p datasets'
                }
            }
        }

        stage('Deploy') {
            steps {
                dir('/home/ubuntu/EdgeLab') {
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
