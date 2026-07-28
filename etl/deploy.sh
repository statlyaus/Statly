#!/bin/bash

# Statly ETL Pipeline Deployment Script

set -e

echo "🚀 Deploying Statly ETL Pipeline"
echo "================================"

# Configuration
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"statly-4cbed"}
REGION=${DEPLOY_REGION:-"us-central1"}
SERVICE_NAME="statly-etl"

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

if [ -z "$FIREBASE_SERVICE_ACCOUNT_JSON_BASE64" ]; then
    echo "❌ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required"
    echo "   Set this to your base64-encoded Firebase service account JSON"
    exit 1
fi

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

# Deploy to Cloud Run
echo ""
echo "☁️  Deploying to Google Cloud Run..."

gcloud run deploy $SERVICE_NAME \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --set-env-vars="FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=$FIREBASE_SERVICE_ACCOUNT_JSON_BASE64" \
    --memory 512Mi \
    --cpu 1 \
    --timeout 900 \
    --max-instances 1 \
    --no-traffic

echo ""
echo "✅ Deployment completed!"
echo ""
echo "📊 Service Details:"
echo "   Name: $SERVICE_NAME"
echo "   Region: $REGION" 
echo "   Project: $PROJECT_ID"
echo ""
echo "🔧 Management Commands:"
echo "   View logs: gcloud run services logs read $SERVICE_NAME --region $REGION"
echo "   Update traffic: gcloud run services update-traffic $SERVICE_NAME --to-latest --region $REGION"
echo "   Delete service: gcloud run services delete $SERVICE_NAME --region $REGION"
echo ""
echo "📈 Monitor at: https://console.cloud.google.com/run/detail/$REGION/$SERVICE_NAME"
