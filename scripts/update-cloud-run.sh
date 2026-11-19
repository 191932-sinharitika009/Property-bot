#!/usr/bin/env bash
# Update the existing service without re-entering or changing its secret.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ID="${1:-project-1275534d-53d6-4c08-b10}"
REGION="${2:-asia-south1}"
gcloud run services describe property-bot --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
gcloud run deploy property-bot --project="$PROJECT_ID" --region="$REGION" --source=. \
  --build-service-account="projects/${PROJECT_ID}/serviceAccounts/property-bot-build@${PROJECT_ID}.iam.gserviceaccount.com" --quiet
URL="$(gcloud run services describe property-bot --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
curl --fail --silent --show-error "${URL}/health"
printf '\nUpdated chatbot: %s\n' "$URL"
