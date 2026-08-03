#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: scripts/deploy-gcp.sh <gcp-project-id> [region]"
  exit 2
fi

PROJECT_ID="$1"
REGION="${2:-us-central1}"
IMAGE_TAG="$(rtk git rev-parse --short HEAD)"
REPOSITORY="${REGION}-docker.pkg.dev/${PROJECT_ID}/botbond"
INTENT_SERVICE_ACCOUNT="botbond-intent@${PROJECT_ID}.iam.gserviceaccount.com"
GATEWAY_SERVICE_ACCOUNT="botbond-gateway@${PROJECT_ID}.iam.gserviceaccount.com"
WEB_SERVICE_ACCOUNT="botbond-web@${PROJECT_ID}.iam.gserviceaccount.com"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

rtk gcloud config set project "$PROJECT_ID"
rtk gcloud services enable \
  aiplatform.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com

if ! rtk gcloud artifacts repositories describe botbond --location "$REGION" >/dev/null 2>&1; then
  rtk gcloud artifacts repositories create botbond --repository-format docker --location "$REGION"
fi

if ! rtk gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  rtk gcloud firestore databases create --database='(default)' --location "$REGION" --type firestore-native
fi

for account in botbond-intent botbond-gateway botbond-web; do
  if ! rtk gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    rtk gcloud iam service-accounts create "$account"
  fi
done

rtk gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${INTENT_SERVICE_ACCOUNT}" --role roles/aiplatform.user
rtk gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${GATEWAY_SERVICE_ACCOUNT}" --role roles/datastore.user
rtk gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${GATEWAY_SERVICE_ACCOUNT}" --role roles/secretmanager.secretAccessor

for secret in botbond-devnet-wallet botbond-evidence-secret botbond-payment-secret; do
  rtk gcloud secrets describe "$secret" >/dev/null
done

rtk gcloud builds submit --config infra/cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_IMAGE_TAG=${IMAGE_TAG}" .

rtk gcloud run deploy botbond-intent-agent \
  --image "${REPOSITORY}/intent-agent:${IMAGE_TAG}" \
  --region "$REGION" \
  --service-account "$INTENT_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --set-env-vars "INTENT_COMPILER_PROVIDER=vertex,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GEMINI_MODEL=${GEMINI_MODEL},GEMINI_TEMPERATURE=0.1"
INTENT_URL="$(rtk gcloud run services describe botbond-intent-agent --region "$REGION" --format='value(status.url)')"

rtk gcloud run deploy botbond-gateway \
  --image "${REPOSITORY}/gateway:${IMAGE_TAG}" \
  --region "$REGION" \
  --service-account "$GATEWAY_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --timeout 300 \
  --set-env-vars "ADAPTER_MODE=solana,REPOSITORY_MODE=firestore,FIRESTORE_NAMESPACE=botbond,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},INTENT_COMPILER_URL=${INTENT_URL},ANCHOR_PROVIDER_URL=https://api.devnet.solana.com,ANCHOR_WALLET=/secrets/botbond-devnet.json,SOLANA_CLUSTER=devnet,BOTBOND_PROGRAM_ID=HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc,SETTLEMENT_AUTHORITY=GMrS1AR2MmHvW9cDmQJ4RApQz6iTS17srfb8bwucJQa6,PUBLIC_DEMO_ENABLED=true,PUBLIC_DEMO_MINT=6iPkutkbMLoMc4bTqUxB8m1d2dtS5RQR2o5ZikW7sVPw,PUBLIC_DEMO_MERCHANT=zdHstotkcGBUSD6BA8QR4osRTMQ7UnzHa3HpvjZYfts,PUBLIC_DEMO_DAILY_LIMIT=30,PUBLIC_DEMO_COOLDOWN_MS=600000,PUBLIC_DEMO_LEASE_MS=120000" \
  --set-secrets "/secrets/botbond-devnet.json=botbond-devnet-wallet:latest,BOTBOND_EVIDENCE_SECRET=botbond-evidence-secret:latest,BOTBOND_PAYMENT_SECRET=botbond-payment-secret:latest"
GATEWAY_URL="$(rtk gcloud run services describe botbond-gateway --region "$REGION" --format='value(status.url)')"

rtk gcloud run deploy botbond-web \
  --image "${REPOSITORY}/web:${IMAGE_TAG}" \
  --region "$REGION" \
  --service-account "$WEB_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --set-env-vars "BOTBOND_GATEWAY_URL=${GATEWAY_URL}"
WEB_URL="$(rtk gcloud run services describe botbond-web --region "$REGION" --format='value(status.url)')"

echo "Intent: ${INTENT_URL}"
echo "Gateway: ${GATEWAY_URL}"
echo "Web: ${WEB_URL}"
