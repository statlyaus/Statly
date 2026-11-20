#!/bin/bash

# Statly ETL Pipeline Deployment Script

set -euo pipefail

echo "🚀 Deploying Statly ETL Pipeline"
echo "================================"

# Configuration
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"statly-4cbed"}
REGION=${DEPLOY_REGION:-"us-central1"}
JOB_NAME="statly-etl"

# Check requirements
echo "📋 Checking requirements..."

if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is required for deployment"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required for deployment"
    exit 1
fi

# Credentials come from Secret Manager, never from this shell or the job's plain environment.
FIREBASE_SECRET=${ETL_FIREBASE_SECRET:-"statly-etl-firebase-service-account"}
DATABASE_URL_SECRET=${ETL_DATABASE_URL_SECRET:-"statly-etl-database-url"}

for secret in "$FIREBASE_SECRET" "$DATABASE_URL_SECRET"; do
    if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" &> /dev/null; then
        echo "❌ Secret Manager secret '$secret' is missing in $PROJECT_ID"
        echo "   Create it and grant the job's service account roles/secretmanager.secretAccessor"
        exit 1
    fi
done

echo "✅ Requirements met"

# Build and test
echo ""
echo "🔨 Building and testing..."
npm ci
npm run build

# Verify the canonical fetch runtime without making an external data request.
echo "📊 Verifying R data fetcher dependencies..."
Rscript -e 'packages <- c("fitzRoy", "jsonlite", "janitor", "dplyr", "stringr"); stopifnot(all(vapply(packages, requireNamespace, logical(1), quietly = TRUE)))'
echo "✅ R data fetcher dependencies available"

# Deploy as a Cloud Run Job: the live guard is a long-running loop with no HTTP listener, so it
# cannot be a Cloud Run service. One task runs the loop for just under a day; Cloud Scheduler starts
# the next execution each day. Nothing is public: the job has no URL.
echo ""
echo "☁️  Deploying the Cloud Run Job..."

gcloud run jobs deploy $JOB_NAME \
    --source . \
    --region $REGION \
    --project $PROJECT_ID \
    --set-secrets="FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=$FIREBASE_SECRET:latest,DATABASE_URL=$DATABASE_URL_SECRET:latest" \
    --memory 512Mi \
    --cpu 1 \
    --tasks 1 \
    --max-retries 1 \
    --task-timeout 86100s

echo ""
echo "✅ Job deployed. It does not run until it is scheduled or executed."
echo ""
echo "🔧 Management Commands:"
echo "   Run once:      gcloud run jobs execute $JOB_NAME --region $REGION --project $PROJECT_ID"
echo "   Schedule daily (needs an invoker service account with roles/run.invoker):"
echo "     gcloud scheduler jobs create http $JOB_NAME-daily --location $REGION --project $PROJECT_ID \\"
echo "       --schedule '0 0 * * *' --time-zone 'Australia/Melbourne' --http-method POST \\"
echo "       --uri https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB_NAME:run \\"
echo "       --oauth-service-account-email <invoker-sa>@$PROJECT_ID.iam.gserviceaccount.com"
echo "   View logs:     gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=$JOB_NAME' --project $PROJECT_ID --limit 50"
echo "   Delete job:    gcloud run jobs delete $JOB_NAME --region $REGION --project $PROJECT_ID"
