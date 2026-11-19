#!/usr/bin/env bash
# Run from Google Cloud Shell. The API key is read silently, never committed.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ID="${1:-project-1275534d-53d6-4c08-b10}"
REGION="${2:-asia-south1}"
SERVICE=property-bot
SECRET=property-bot-openrouter-key
RUNTIME_ACCOUNT="property-bot-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_ACCOUNT="property-bot-build@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com
if ! gcloud iam service-accounts describe "$RUNTIME_ACCOUNT" >/dev/null 2>&1; then
  gcloud iam service-accounts create property-bot-runtime --display-name='Property Bot runtime'
fi
if ! gcloud iam service-accounts describe "$BUILD_ACCOUNT" >/dev/null 2>&1; then
  gcloud iam service-accounts create property-bot-build --display-name='Property Bot builder'
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_ACCOUNT}" \
  --role=roles/run.builder --condition=None --quiet >/dev/null
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --replication-policy=automatic
fi
read -r -s -p 'Paste your OpenRouter API key (hidden), then press Enter: ' OPENROUTER_KEY
printf '\n'
if [[ -z "$OPENROUTER_KEY" ]]; then echo 'No key provided. Deployment stopped.'; exit 1; fi
VERSION="$(printf '%s' "$OPENROUTER_KEY" | gcloud secrets versions add "$SECRET" --data-file=- --format='value(name)')"
unset OPENROUTER_KEY
VERSION="${VERSION##*/}"
gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:${RUNTIME_ACCOUNT}" \
  --role=roles/secretmanager.secretAccessor --quiet >/dev/null
gcloud run deploy "$SERVICE" --source=. --region="$REGION" \
  --build-service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}" \
  --service-account="$RUNTIME_ACCOUNT" --allow-unauthenticated \
  --port=8000 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=1 \
  --concurrency=8 --timeout=60 --cpu-throttling \
  --set-env-vars='COOKIE_SECURE=true,OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free' \
  --set-secrets="OPENROUTER_API_KEY=${SECRET}:${VERSION}" --quiet
URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
printf '\nChatbot URL: %s\n' "$URL"
curl --fail --silent --show-error "${URL}/health"
printf '\nOpen the URL and test a question with citations.\n'
