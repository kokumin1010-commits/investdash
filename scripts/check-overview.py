"""買い増しプラン一覧の内容を確認する（保有・未保有の両方）。"""
import json
import subprocess
import sys

TOKEN = open("/tmp/token").read().strip()
BASE = "http://127.0.0.1:3000"

out = subprocess.run(
    [
        "curl", "-s", "-G",
        f"{BASE}/api/trpc/portfolio.priceBandOverview",
        "-H", f"Authorization: Bearer {TOKEN}",
    ],
    capture_output=True, text=True,
).stdout

try:
    payload = json.loads(out)
except json.JSONDecodeError:
    print("RAW:", out[:300])
    sys.exit(1)

if "error" in payload:
    print("ERROR:", json.dumps(payload["error"], ensure_ascii=False)[:300])
    sys.exit(1)

data = payload["result"]["data"]["json"]
rows = data["rows"]
stats = data.get("stats")
print("rows:", len(rows), "stats:", json.dumps(stats, ensure_ascii=False))

watch = [r for r in rows if not r.get("held")]
print("未保有:", len(watch))

targets = {"CDNS", "TSM", "ASML", "VRT", "CRDO", "QCOM", "UBER", "NXPI", "CRM"}
for r in rows:
    if r["symbol"] in targets:
        print(
            f"{r['symbol']:6} price={r.get('currentPrice')} "
            f"action={r.get('actionLabel')} "
            f"next={r.get('nextGapPct')} -> {r.get('nextActionLabel')} "
            f"held={r.get('held')} tooFar={r.get('targetTooFar')}"
        )
