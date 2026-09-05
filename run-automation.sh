#!/usr/bin/env bash
# ==============================================================================
# Code Automation & Visual Progress / Error Orchestrator (Option A)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_PY="/home/superadmin/workspace/automation-orchestrator/orchestrator.py"
ENV_FILE="/home/superadmin/workspace/automation-orchestrator/.env"

# Auto-load environment variables if .env exists
if [ -f "$ENV_FILE" ]; then
    set -a
    source <(grep -v '^#' "$ENV_FILE" | sed -e 's/\r$//')
    set +a
fi

# Target defaults
PROJECT_DIR="${PROJECT_DIR:-/home/superadmin/workspace/toko}"
CMD_TO_RUN="${1:-npm run build}"
ROUTER_URL="${ROUTER_URL:-http://localhost:20128/v1}"
TEXT_MODEL="${TEXT_MODEL:-claude-3-7-sonnet}"
IMAGE_API_URL="${IMAGE_API_URL:-${DEFAULT_IMAGE_API_URL:-https://api-images.bynara.id/v1/images/generations}}"
IMAGE_MODEL="${IMAGE_MODEL:-${MODEL_NAME:-agnes-image-2.1-flash}}"

# Allow passing a custom project as 2nd arg if provided
if [ -n "$2" ] && [ -d "$2" ]; then
    PROJECT_DIR="$2"
fi

echo "========================================================"
echo "🚀 Code Automation & Visual Telegram Orchestrator"
echo "📂 Project:     $PROJECT_DIR"
echo "⚡ Command:     $CMD_TO_RUN"
echo "🧠 9Router:     $ROUTER_URL ($TEXT_MODEL)"
echo "🎨 Image API:   $IMAGE_API_URL ($IMAGE_MODEL)"
echo "========================================================"

python3 "$ORCHESTRATOR_PY" \
  --project "$PROJECT_DIR" \
  --cmd "$CMD_TO_RUN" \
  --router-url "$ROUTER_URL" \
  --text-model "$TEXT_MODEL" \
  --image-url "$IMAGE_API_URL" \
  --image-model "$IMAGE_MODEL"
