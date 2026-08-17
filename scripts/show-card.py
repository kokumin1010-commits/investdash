"""投資カードの中身を確認する。"""
import json
import subprocess
import sys
import urllib.parse

tok = open("/tmp/token").read().strip()


def q(proc, inp):
    url = f"http://127.0.0.1:3000/api/trpc/{proc}?input=" + urllib.parse.quote(
        json.dumps({"json": inp})
    )
    out = subprocess.run(
        ["curl", "-s", "-G", url, "-H", f"Authorization: Bearer {tok}"],
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out).get("result", {}).get("data", {}).get("json")


for sym in sys.argv[1:]:
    c = q("portfolio.card", {"symbol": sym})
    print(f"=== {sym} ===")
    if not c:
        print("  カードなし")
        continue
    for k in ("buyReason", "coreThesis", "valuationAssumption", "exitConditions", "risks"):
        v = (c.get(k) or "").strip()
        if v:
            print(f"  [{k}] {v[:220]}")
    print(f"  確信度: {c.get('conviction')}")
