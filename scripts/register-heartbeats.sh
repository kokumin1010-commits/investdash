#!/usr/bin/env bash
set -euo pipefail

# Run only after the latest checkpoint has been published.
# Cron expressions use UTC; descriptions include the equivalent JST schedule.

create_job() {
  local name="$1"
  local cron="$2"
  local path="$3"
  local description="$4"

  manus-heartbeat create \
    --name "$name" \
    --cron "$cron" \
    --path "$path" \
    --payload '{}' \
    --description "$description"
}

create_job \
  "investdash-jp-close-prices" \
  "0 30 6 * * 1-5" \
  "/api/scheduled/syncPrices" \
  "InvestDash price refresh after Japan market close, weekdays 15:30 JST"

create_job \
  "investdash-us-close-prices" \
  "0 30 21 * * 1-5" \
  "/api/scheduled/syncPrices" \
  "InvestDash price refresh after US market close, weekdays 06:30 JST"

# 123 unique symbols require 31 batches at four symbols per callback.
# Start daily at 07:00 JST (22:00 UTC) and stagger by three minutes so each
# callback stays within the platform's two-minute execution limit.
for batch in $(seq 0 30); do
  total_minutes=$((22 * 60 + batch * 3))
  hour=$(((total_minutes / 60) % 24))
  minute=$((total_minutes % 60))
  jst_total=$((7 * 60 + batch * 3))
  jst_hour=$((jst_total / 60))
  jst_minute=$((jst_total % 60))

  create_job \
    "investdash-news-batch-${batch}" \
    "0 ${minute} ${hour} * * *" \
    "/api/scheduled/syncNews/${batch}" \
    "InvestDash daily news batch ${batch}/30 at $(printf '%02d:%02d' "$jst_hour" "$jst_minute") JST"
done
