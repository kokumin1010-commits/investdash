#!/usr/bin/env python3
"""指定した月の比較結果を表示する（検証用）。"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3000"
API = f"{BASE}/api/trpc"
UA = "curl/8.5.0"
TO = sys.argv[1] if len(sys.argv) > 1 else "2026-08"


def unlock() -> str:
    req = urllib.request.Request(
        f"{API}/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["result"]["data"]["json"]["token"]


def get(token: str, proc: str, payload=None):
    url = f"{API}/{proc}"
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["result"]["data"]["json"]


def main() -> None:
    token = unlock()
    cmp_ = get(token, "import.monthlyCompare", {"toPeriod": TO})
    if cmp_ is None:
        print("比較できる相手がない")
        return
    b = cmp_["breakdown"]
    print(f"{cmp_['fromPeriod']} → {cmp_['toPeriod']}  行 {len(cmp_['rows'])} 件")
    kinds: dict[str, int] = {}
    for r in cmp_["rows"]:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"区分: {kinds}")
    print(f"総変化 ¥{b['totalDeltaJpy']:,.0f}")
    print(f"  新規 ¥{b['newBuyJpy']:,.0f}")
    print(f"  買い増し ¥{b['addedCostJpy']:,.0f}")
    print(f"  売却 ¥{b['soldJpy']:,.0f}")
    print(f"  一部売却 ¥{b['reducedJpy']:,.0f}")
    print(f"  値動き ¥{b['priceMoveJpy']:,.0f}")
    shown = (
        b["newBuyJpy"] + b["addedCostJpy"] + b["soldJpy"] + b["reducedJpy"] + b["priceMoveJpy"]
    )
    diff = abs(shown - b["totalDeltaJpy"])
    print(f"内訳合計 ¥{shown:,.0f}  差 ¥{diff:,.2f} → {'一致' if diff < 1 else '不一致'}")
    print("売買のあった行:")
    for r in cmp_["rows"]:
        if r["kind"] == "SAME":
            continue
        print(
            f"  [{r['kind']}] {r['name']} ({r['symbol']} / {r['broker']}) "
            f"{r['prevQuantity']} → {r['currQuantity']} 株 "
            f"（{r['quantityDelta']:+g}） 評価額 {r['valueDeltaJpy']}"
        )


if __name__ == "__main__":
    main()
