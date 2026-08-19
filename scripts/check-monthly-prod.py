#!/usr/bin/env python3
"""本番の月次記録 API を確認する。"""
import json
import sys
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://investdash-h5pd9fya.manus.space"
API = f"{BASE}/api/trpc"


def unlock() -> str:
    req = urllib.request.Request(
        f"{API}/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["result"]["data"]["json"]["token"]


def get(token: str, proc: str, payload=None):
    url = f"{API}/{proc}"
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": "curl/8.5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["result"]["data"]["json"]


def main() -> None:
    token = unlock()
    rows = get(token, "import.monthlyList")
    print(f"記録: {len(rows)} 件")
    for r in rows:
        print(
            f"  {r['periodYm']}  評価額 ¥{r['totalValueJpy']:,.0f}  "
            f"純資産 ¥{(r['netAssetsJpy'] or 0):,.0f}  "
            f"銘柄 {r['symbolCount']} / レコード {r['recordCount']}  "
            f"USD/JPY {r['usdJpy']}  source={r['source']}"
        )

    cmp_ = get(token, "import.monthlyCompare", {})
    if cmp_ is None:
        print("比較: 記録が 1 件のため比較対象なし（正しい挙動）")
    else:
        b = cmp_["breakdown"]
        print(f"比較: {cmp_['fromPeriod']} → {cmp_['toPeriod']}")
        print(f"  総変化 ¥{b['totalDeltaJpy']:,.0f}")
        print(f"  新規 ¥{b['newBuyJpy']:,.0f} / 買い増し ¥{b['addedCostJpy']:,.0f}")
        print(f"  売却 ¥{b['soldJpy']:,.0f} / 一部売却 ¥{b['reducedJpy']:,.0f}")
        print(f"  値動き ¥{b['priceMoveJpy']:,.0f}")
        kinds: dict[str, int] = {}
        for row in cmp_["rows"]:
            kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
        print(f"  行の内訳: {kinds}")


if __name__ == "__main__":
    main()
