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

if [ -z "$GOOGLE_SERVICE_ACCOUNT" ]; then
    echo "❌ GOOGLE_SERVICE_ACCOUNT environment variable is required"
    echo "   Set this to your Firebase service account JSON string"
    exit 1
fi

echo "✅ Requirements met"

# Build and test
echo ""
echo "🔨 Building and testing..."
npm install
npm run build

# Test Python script
echo "🐍 Testing Python data fetcher..."
python3 fetch_fw_round.py 2025 18 /tmp/test_deploy.json
if [ ! -f "/tmp/test_deploy.json" ]; then
    echo "❌ Python script test failed"
    exit 1
fi
echo "✅ Python script working"

# Deploy to Cloud Run
echo ""
echo "☁️  Deploying to Google Cloud Run..."

gcloud run deploy $SERVICE_NAME \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --set-env-vars GOOGLE_SERVICE_ACCOUNT="$GOOGLE_SERVICE_ACCOUNT" \
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
