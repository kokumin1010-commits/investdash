"""本番でメモ蓄積・データ健全性・カード自動生成の下地が動くか確認する。"""
import json
import subprocess
import urllib.parse

BASE = "https://investdash-h5pd9fya.manus.space"


def post(proc, inp):
    out = subprocess.run(
        [
            "curl", "-s", "-X", "POST", f"{BASE}/api/trpc/{proc}",
            "-H", "Content-Type: application/json",
            *(["-H", f"Authorization: Bearer {TOKEN}"] if TOKEN else []),
            "-d", json.dumps({"json": inp}),
        ],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def get(proc, inp=None):
    url = f"{BASE}/api/trpc/{proc}"
    if inp is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": inp}))
    out = subprocess.run(
        ["curl", "-s", "-G", url, "-H", f"Authorization: Bearer {TOKEN}"],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


TOKEN = ""
r = post("auth.unlock", {"passcode": "1010"})
TOKEN = r["result"]["data"]["json"]["token"]
print("unlock: ok")

h = get("portfolio.dataHealth").get("result", {}).get("data", {}).get("json")
if h:
    print("dataHealth: " + json.dumps(h, ensure_ascii=False)[:400])

n = get("portfolio.symbolNotes", {"symbol": "8058.T", "limit": 5}).get("result", {}).get("data", {}).get("json")
if isinstance(n, list):
    print(f"symbolNotes(8058.T): {len(n)} 件")
    for row in n[:3]:
        print(f"  - {str(row.get('occurredAt'))[:10]} [{row.get('kind')}] {str(row.get('headline'))[:70]}")
