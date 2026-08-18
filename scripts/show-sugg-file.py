"""保存済みの提案 JSON（curl 出力）を読みやすく表示する。"""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/prodsugg.json"
d = json.load(open(path))
r = d.get("result", {}).get("data", {}).get("json")
if not r:
    print(json.dumps(d)[:800])
    raise SystemExit(1)

print("overview:", r["overview"][:300])
print(f"gaps={len(r['gaps'])} candidates={len(r['candidates'])} rejected={len(r['rejected'])}")
for c in r["candidates"]:
    print(
        f"[{c['track']}] {c['symbol']:<10} {c['verifiedName'][:26]:<26} "
        f"basedOn={c['basedOn']} prio={c['priority']} "
        f"now={c['currentPrice']} tgt={c['targetPrice']} gap={c['gapToTargetPct']}"
    )
    print(f"        理由: {c['reason'][:150]}")
    if c.get("targetAdjustedNote"):
        print(f"        補正: {c['targetAdjustedNote'][:130]}")
for x in r["rejected"]:
    print("  rejected:", x["symbol"], x["reason"][:70])
