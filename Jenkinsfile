pipeline {

    agent any

    options {
        timestamps()
        skipDefaultCheckout(true)
        skipStagesAfterUnstable()
        disableConcurrentBuilds(abortPrevious: true)
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    stages {

        // ============================================================
        // CHECKOUT
        // ============================================================
        stage('Checkout') {
            agent {
                docker {
                    image 'oven/bun:alpine'
                    reuseNode true
                }
            }

            steps {
                checkout scm
                sh '''
                    set -e
                    echo "=== Workspace ==="
                    ls -la
                    test -f package.json
                    test -f bun.lock
                    test -f Jenkinsfile
                    echo "=== Checkout OK ==="
                '''
            }
        }

        // ============================================================
        // INSTALL DEPENDENCIES
        // ============================================================
        stage('Install Dependencies') {
            agent {
                docker {
                    image 'oven/bun:alpine'
                    reuseNode true
                }
            }

            steps {
                sh '''
                    set -e

                    echo "=== Installing Dependencies ==="

                    # --frozen-lockfile memastikan versi dependency identik
                    # dengan yang ada di bun.lock (tidak auto-update).
                    bun install --frozen-lockfile

                    echo "=== Dependencies Installed ==="
                '''
            }
        }

        // ============================================================
        // TEST (BUN + COVERAGE LCOV)
        // ============================================================
        stage('Test') {
            agent {
                docker {
                    image 'oven/bun:alpine'
                    reuseNode true
                }
            }

            steps {
                sh '''
                    set -e

                    echo "=== Running Tests with Coverage (Bun) ==="

                    # --coverage-reporter=lcov + --coverage-dir=coverage
                    # wajib agar SonarQube bisa membaca coverage/lcov.info.
                    bun test --coverage \
                             --coverage-reporter=lcov \
                             --coverage-dir=coverage

                    echo "=== Tests Passed ==="
                    ls -lh coverage/lcov.info
                '''
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: 'coverage/**',
                        allowEmptyArchive: true
                    )
                }
            }
        }

        // ============================================================
        // TRIVY SECURITY SCAN
        // ============================================================
        stage('Trivy Security Scan') {
            agent {
                docker {
                    image 'aquasec/trivy:0.74.0'
                    reuseNode true

                    args '''
                        --entrypoint=""
                        -e HOME=/tmp
                        -e XDG_CACHE_HOME=/tmp/.cache
                    '''
                }
            }

            steps {
                sh '''
                    set -e

                    mkdir -p .trivy-cache || true

                    echo "======================================"
                    echo "        TRIVY SECURITY SCAN"
                    echo "======================================"

                    trivy --version

                    trivy fs \
                        --cache-dir .trivy-cache \
                        --scanners vuln \
                        --severity HIGH,CRITICAL \
                        --format sarif \
                        --output trivy-results.sarif \
                        --exit-code 1 \
                        .

                    echo "=== Trivy Result ==="
                    ls -lh trivy-results.sarif
                '''
            }

            post {
                always {
                    recordIssues(
                        enabledForFailure: true,
                        failOnError: false,
                        tools: [
                            sarif(
                                id: 'trivy',
                                name: 'Trivy Security',
                                pattern: 'trivy-results.sarif'
                            )
                        ]
                    )
                }
            }
        }

        // ============================================================
        // SONARQUBE ANALYSIS
        // ============================================================
        stage('SonarQube Analysis') {
            agent {
                docker {
                    image 'sonarsource/sonar-scanner-cli:latest'
                    reuseNode true
                    args '--network cicd-network'
                }
            }

            steps {
                withSonarQubeEnv('SonarQube') {
                    sh '''
                        set -e
                        echo "=== SonarQube Analysis ==="
                        sonar-scanner
                        echo "=== SonarQube Analysis Completed ==="
                    '''
                }
            }
        }

        // ============================================================
        // QUALITY GATE
        // ============================================================
        stage('Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        // ============================================================
        // PACKAGE APPLICATION
        // ============================================================
        stage('Package Application') {
            agent {
                docker {
                    image 'node:24-alpine'
                    reuseNode true
                    args '-u root'
                }
            }

            steps {
                sh '''
                    set -e

                    echo "======================================"
                    echo "       CREATING APPLICATION PACKAGE"
                    echo "======================================"

                    apk add --no-cache zip unzip

                    rm -f latest-app.zip

                    zip -r latest-app.zip . \
                        -x "node_modules/*" \
                        -x ".git/*" \
                        -x ".env" \
                        -x ".env.local" \
                        -x ".env.production" \
                        -x ".env.development" \
                        -x ".env.test" \
                        -x "coverage/*" \
                        -x "data/*" \
                        -x "logs/*" \
                        -x "*.db" \
                        -x "*.db-shm" \
                        -x "*.db-wal" \
                        -x ".trivy-cache/*" \
                        -x "latest-app.zip" \
                        -x "trivy-results.sarif" \
                        -x ".bun/*" \
                        -x ".docs/*"

                    echo "=== Application Package Created ==="
                    ls -lh latest-app.zip

                    echo "=== Package Content (ringkas) ==="
                    unzip -l latest-app.zip | head -n 40
                '''
            }
        }

        // ============================================================
        // PUBLISH APPLICATION
        // ============================================================
        stage('Publish Application') {

            steps {

                archiveArtifacts(
                    artifacts: 'latest-app.zip',
                    fingerprint: true,
                    allowEmptyArchive: false
                )

                script {

                    def appName = env.JOB_NAME
                        .replaceAll('[^a-zA-Z0-9._-]', '-')
                        .replaceAll('-+', '-')
                        .replaceAll('^-|-$', '')

                    def buildId = env.BUILD_NUMBER

                    echo "Application Name: ${appName}"
                    echo "Build ID: ${buildId}"

                    sh """
                        set -e

                        echo "======================================"
                        echo "       PUBLISHING USER CONTENT"
                        echo "======================================"

                        docker exec cicd-jenkins \
                            mkdir -p \
                            "/var/jenkins_home/userContent/applications/${appName}/${buildId}"

                        docker cp \
                            latest-app.zip \
                            "cicd-jenkins:/var/jenkins_home/userContent/applications/${appName}/${buildId}/latest-app.zip"

                        echo "=== Published File ==="

                        docker exec cicd-jenkins \
                            ls -lh \
                            "/var/jenkins_home/userContent/applications/${appName}/${buildId}/latest-app.zip"
                    """

                    def jenkinsBaseUrl = env.BUILD_URL
                        .substring(0, env.BUILD_URL.indexOf('/job/'))
                        .replace('localhost', 'host.docker.internal')

                    env.ARTIFACT_URL =
                        "${jenkinsBaseUrl}/userContent/applications/${appName}/${buildId}/latest-app.zip"

                    echo "======================================"
                    echo "       APPLICATION PUBLISHED"
                    echo "======================================"
                    echo "Artifact URL:"
                    echo "${env.ARTIFACT_URL}"
                }
            }
        }

        // ============================================================
        // DEPLOY APPLICATION
        // ============================================================
        stage('Deploy Application') {
            agent {
                docker {
                    image 'curlimages/curl:8.15.0'
                    reuseNode true
                    args '--network cicd-network'
                }
            }

            steps {
                script {

                    echo "=========================================="
                    echo "       START APPLICATION DEPLOYMENT"
                    echo "=========================================="
                    echo "Artifact URL:"
                    echo "${env.ARTIFACT_URL}"

                    // ==================================================
                    // 1. REQUEST REDEPLOYMENT
                    // ==================================================
                    echo ""
                    echo "=== Request Redeployment ==="

                    def redeployResponse = sh(
                        script: '''
                            set -e

                            curl -sS --fail-with-body \
                                -X POST "$URL_REDEPLOY" \
                                -H "Content-Type: application/json" \
                                -d "{
                                    \\"token_access\\": \\"$DEPLOY_TOKEN\\",
                                    \\"website_id\\": \\"$WEBSITE_ID\\",
                                    \\"source_url\\": \\"$ARTIFACT_URL\\",
                                    \\"source_type\\": \\"jenkins\\"
                                }"
                        ''',
                        returnStdout: true
                    ).trim()

                    echo "Redeploy Response:"
                    echo redeployResponse

                    // ==================================================
                    // 2. POLLING DEPLOYMENT PROGRESS
                    // ==================================================
                    echo ""
                    echo "=== Waiting For Deployment ==="

                    def maxAttempts = 120
                    def attempt = 0
                    def deploymentStatus = 'IN_PROGRESS'

                    while (deploymentStatus == 'IN_PROGRESS') {

                        attempt++

                        if (attempt > maxAttempts) {
                            error(
                                "Deployment timeout. " +
                                "Status masih IN_PROGRESS setelah " +
                                "${maxAttempts} attempts."
                            )
                        }

                        sleep time: 5, unit: 'SECONDS'

                        echo ""
                        echo "=== Checking Deployment Progress (${attempt}/${maxAttempts}) ==="

                        def progressResponse = sh(
                            script: '''
                                set -e

                                curl -sS --fail-with-body \
                                    -X POST "$URL_PROGRESS" \
                                    -H "Content-Type: application/json" \
                                    -d "{
                                        \\"token_access\\": \\"$DEPLOY_TOKEN\\",
                                        \\"website_id\\": \\"$WEBSITE_ID\\"
                                    }"
                            ''',
                            returnStdout: true
                        ).trim()

                        echo "Progress Response:"
                        echo progressResponse

                        def json = readJSON text: progressResponse

                        deploymentStatus = json?.data?.status
                            ?.toString()
                            ?.toUpperCase()

                        if (!deploymentStatus) {
                            error("Response progress tidak memiliki data.status")
                        }

                        echo "Deployment Status: ${deploymentStatus}"

                        if (deploymentStatus == 'SUCCESS') {
                            echo ""
                            echo "=========================================="
                            echo "       ✅ DEPLOYMENT SUCCESS (panel)"
                            echo "=========================================="
                            break
                        }

                        if (deploymentStatus == 'FAIL') {
                            echo ""
                            echo "=========================================="
                            echo "       ❌ DEPLOYMENT FAILED (panel)"
                            echo "=========================================="

                            def deploymentLog =
                                json?.data?.log
                                    ?: 'Deployment failed tanpa log.'

                            echo ""
                            echo "========== DEPLOYMENT LOG =========="
                            echo deploymentLog
                            echo "===================================="

                            error("Deployment gagal untuk website ${WEBSITE_ID}")
                        }

                        echo "Deployment masih berjalan..."
                    }

                    echo ""
                    echo "=========================================="
                    echo "       PANEL DEPLOYMENT FINISHED"
                    echo "=========================================="
                    echo "Lanjut ke stage Verify Deployment untuk memastikan app benar-benar hidup."
                }
            }
        }

        // ============================================================
        // VERIFY DEPLOYMENT  ← stage khusus BE
        // ============================================================
        // Panel deploy bisa melaporkan SUCCESS meskipun proses app
        // langsung mati (mis. JWT_SECRET kosong, SQLITE_PATH salah,
        // src/index.ts tidak listen). Stage ini memastikan aplikasi
        // benar-benar melayani /api/v1/health.
        // ============================================================
        stage('Verify Deployment') {
            agent {
                docker {
                    image 'curlimages/curl:8.15.0'
                    reuseNode true
                    args '--network cicd-network'
                }
            }

            steps {
                sh '''
                    set -e

                    URL="https://ifs24039-pabwe2026-proyek1-be.s1if.cloud/api/v1/health"
                    echo "=== Health check: ${URL} ==="

                    for i in $(seq 1 30); do
                        if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
                            echo "[VERIFY] OK setelah ${i} percobaan"
                            echo "--- Body ---"
                            curl -sS --max-time 5 "$URL"
                            echo ""
                            exit 0
                        fi
                        echo "[VERIFY] attempt ${i}/30 belum OK, tunggu 2s..."
                        sleep 2
                    done

                    echo "[VERIFY] FAILED — endpoint health tidak merespon dalam 60 detik."
                    echo "Cek di server:"
                    echo "  /home/delcom/app/ifs24039-pabwe2026-proyek1-be.s1if.cloud/logs/app.log"
                    exit 1
                '''
            }
        }
    }

    // ================================================================
    // POST ACTIONS
    // ================================================================
    post {

        always {
            archiveArtifacts(
                artifacts: 'trivy-results.sarif, coverage/**',
                allowEmptyArchive: true
            )
        }

        success {
            echo "=========================================="
            echo "       ✅ PIPELINE SUCCESS"
            echo "=========================================="
            echo "Result: ${currentBuild.currentResult}"
            echo "📦 Artifact: ${env.ARTIFACT_URL ?: '(not published)'}"
            echo "🚀 Website: https://ifs24039-pabwe2026-proyek1-be.s1if.cloud"
        }

        failure {
            echo "=========================================="
            echo "       ❌ PIPELINE FAILED"
            echo "=========================================="
            echo "Result: ${currentBuild.currentResult}"
            echo "Periksa log stage yang merah / Console Output untuk penyebab gagal."
            echo ""
            echo "Petunjuk cepat:"
            echo " - Test merah         → jalankan 'bun test' di lokal"
            echo " - Trivy merah        → ada CVE HIGH/CRITICAL di dependency"
            echo " - Deploy merah       → cek WEBSITE_ID & DEPLOY_TOKEN di job config"
            echo " - Verify merah       → cek logs/app.log di server (JWT_SECRET / SQLITE_PATH / port)"
        }

        unstable {
            echo "=========================================="
            echo "       ⚠️ PIPELINE UNSTABLE"
            echo "=========================================="
            echo "Result: ${currentBuild.currentResult}"
        }
    }
}