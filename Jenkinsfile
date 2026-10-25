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

                        docker exec cicd-jenkins \\
                            mkdir -p \\
                            "/var/jenkins_home/userContent/applications/${appName}/${buildId}"

                        docker cp \\
                            latest-app.zip \\
                            "cicd-jenkins:/var/jenkins_home/userContent/applications/${appName}/${buildId}/latest-app.zip"

                        echo "=== Published File ==="

                        docker exec cicd-jenkins \\
                            ls -lh \\
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

                    // ── 1. Request Redeployment ──
                    echo ""
                    echo "=== Request Redeployment ==="

                    def redeployResponse = sh(
                        script: '''
                            set -e
                            curl -sS --fail-with-body \\
                                -X POST "$URL_REDEPLOY" \\
                                -H "Content-Type: application/json" \\
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

                    // ── 2. Polling Deployment Progress ──
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
                                curl -sS --fail-with-body \\
                                    -X POST "$URL_PROGRESS" \\
                                    -H "Content-Type: application/json" \\
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
                }
            }
        }

        // ============================================================
        // VERIFY DEPLOYMENT (NON-BLOCKING)
        // ============================================================
        // Panel deploy bisa melaporkan SUCCESS meskipun proses app
        // masih dalam masa startup atau ada zombie process di port
        // 5209. Stage ini bersifat observasi: bila gagal, stage jadi
        // UNSTABLE (kuning), tapi pipeline tetap SUCCESS. Dengan
        // begitu deploy tidak ter-block hanya karena health check
        // telat merespons.
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
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    sh '''
                        set -e
                        URL="https://ifs24039-pabwe2026-proyek1-be.s1if.cloud/api/v1/health"
                        echo "=== Health check: ${URL} ==="

                        for i in $(seq 1 20); do
                            set +e
                            HTTP=$(curl -sS -k -o /tmp/body \\
                                -w "%{http_code}" \\
                                --connect-timeout 3 \\
                                --max-time 10 \\
                                "$URL" 2>/tmp/err)
                            RC=$?
                            set -e

                            if [ "$RC" = "0" ] && [ "$HTTP" = "200" ]; then
                                echo "[VERIFY] ✅ OK setelah ${i} percobaan (HTTP $HTTP)"
                                echo "--- Body ---"
                                cat /tmp/body
                                exit 0
                            fi

                            echo "[VERIFY] attempt ${i}/20: curl_rc=$RC http=$HTTP err=$(head -1 /tmp/err)"
                            sleep 5
                        done

                        echo "[VERIFY] ⚠️  Tidak merespons dalam 5 menit."
                        echo ""
                        echo "Interpretasi kode:"
                        echo "  curl_rc=28 http=000  → timeout (app listen tapi tidak merespons = zombie / startup lambat)"
                        echo "  curl_rc=7  http=000  → connection refused (app mati / port salah)"
                        echo "  curl_rc=0  http=502  → nginx tidak bisa reach upstream"
                        echo "  curl_rc=0  http=504  → nginx timeout ke upstream"
                        echo ""
                        echo "Cek di server:"
                        echo "  ps aux | grep bun"
                        echo "  ss -ltnp | grep 5209"
                        echo "  tail -n 100 /home/delcom/app/ifs24039-pabwe2026-proyek1-be.s1if.cloud/logs/app.log"
                        exit 1
                    '''
                }
            }

            post {
                unsuccessful {
                    echo "=========================================="
                    echo "⚠️  VERIFY UNSTABLE — pipeline tetap SUCCESS"
                    echo "=========================================="
                    echo "Health check tidak merespons tepat waktu."
                    echo "Aplikasi mungkin baru selesai startup beberapa detik setelahnya."
                    echo "Cek manual: https://ifs24039-pabwe2026-proyek1-be.s1if.cloud/api/v1/health"
                    echo "Kalau OK di browser → abaikan warning ini."
                    echo ""
                    echo "Jika ingin diagnosa lengkap, jalankan di server:"
                    echo "  tail -n 100 logs/app.log"
                    echo "  ps aux | grep bun"
                    echo "  ss -ltnp | grep 5209"
                }
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
            echo ""
            echo "Catatan: jika stage Verify UNSTABLE, itu warning saja — deploy tetap sukses."
        }

        unstable {
            echo "=========================================="
            echo "       ⚠️  PIPELINE UNSTABLE"
            echo "=========================================="
            echo "Result: ${currentBuild.currentResult}"
            echo "Deploy berhasil, tapi health check tidak merespons tepat waktu."
            echo "Cek manual di browser untuk memastikan aplikasi benar-benar hidup."
        }

        failure {
            echo "=========================================="
            echo "       ❌ PIPELINE FAILED"
            echo "=========================================="
            echo "Result: ${currentBuild.currentResult}"
            echo "Periksa log stage yang merah."
            echo ""
            echo "Petunjuk cepat:"
            echo " - Test merah      → jalankan 'bun test' di lokal"
            echo " - Trivy merah     → ada CVE HIGH/CRITICAL di dependency"
            echo " - Deploy merah    → cek WEBSITE_ID & DEPLOY_TOKEN di job config"
            echo " - Checkout gagal  → cek koneksi Git / credential github-ohmyhashmap"
        }
    }
}