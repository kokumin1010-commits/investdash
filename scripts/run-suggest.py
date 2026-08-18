"""候補提案（2 系統）を実行して内容を確認する。"""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"


def post(path, token, payload):
    req = urllib.request.Request(
        f"{BASE}/api/trpc/{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=175) as r:
        return json.load(r)


tok = post("auth.unlock", None, {"json": {"passcode": "1010"}})
token = tok["result"]["data"]["json"]["token"]

res = post("portfolio.suggestCandidates", token, {"json": {}})
r = res.get("result", {}).get("data", {}).get("json")
if not r:
    print(json.dumps(res)[:800])
    raise SystemExit(1)

print("overview:", r["overview"][:260])
print(f"gaps={len(r['gaps'])} candidates={len(r['candidates'])} rejected={len(r['rejected'])}")
for g in r["gaps"]:
    print(f"  gap[{g['kind']}] {g['label']}: {g['evidence'][:110]}")
for c in r["candidates"]:
    print(
        f"[{c['track']}] {c['symbol']:<10} {c['verifiedName'][:26]:<26} "
        f"basedOn={c['basedOn']} ind={c['industry']} prio={c['priority']} "
        f"now={c['currentPrice']} tgt={c['targetPrice']} gap={c['gapToTargetPct']}"
    )
    print(f"        理由: {c['reason'][:170]}")
for x in r["rejected"]:
    print("  rejected:", x["symbol"], x["reason"][:70])
