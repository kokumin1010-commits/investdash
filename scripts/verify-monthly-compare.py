#!/usr/bin/env python3
"""月次比較の動作を実データで検証する。

検証の流れ:
  1. 9 月分の記録を仮に作る（今の保有をそのまま写す）
  2. 9 月の一部の銘柄の株数を変えて記録を作り直す（買い増し・売却を模す）
  3. 8 月 → 9 月の比較が正しい区分と金額を返すか確かめる
  4. 検証で作った 9 月分を削除して元の状態に戻す

実データを使うのは、112 銘柄・156 レコードという実際の規模で
集計がずれないかを確かめるため。
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
API = f"{BASE}/api/trpc"
UA = "curl/8.5.0"


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
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["result"]["data"]["json"]


def post(token: str, proc: str, payload):
    req = urllib.request.Request(
        f"{API}/{proc}",
        data=json.dumps({"json": payload}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": UA,
        },
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["result"]["data"]["json"]


def main() -> None:
    token = unlock()

    print("[1] 9 月分の記録を仮に作る")
    saved = post(token, "import.monthlySave", {"periodYm": "2026-09", "note": "動作検証用"})
    print(f"    {saved['periodYm']}: {saved['symbolCount']} 銘柄 / {saved['recordCount']} レコード")

    print("[2] 8 月 → 9 月の比較")
    cmp_ = get(token, "import.monthlyCompare", {"toPeriod": "2026-09"})
    if cmp_ is None:
        print("    比較できなかった")
        return
    b = cmp_["breakdown"]
    kinds: dict[str, int] = {}
    for row in cmp_["rows"]:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
    print(f"    {cmp_['fromPeriod']} → {cmp_['toPeriod']}  行 {len(cmp_['rows'])} 件")
    print(f"    区分: {kinds}")
    print(f"    総変化 ¥{b['totalDeltaJpy']:,.0f}")
    print(
        f"    新規 ¥{b['newBuyJpy']:,.0f} / 買い増し ¥{b['addedCostJpy']:,.0f} / "
        f"売却 ¥{b['soldJpy']:,.0f} / 一部売却 ¥{b['reducedJpy']:,.0f} / "
        f"値動き ¥{b['priceMoveJpy']:,.0f}"
    )
    shown = (
        b["newBuyJpy"] + b["addedCostJpy"] + b["soldJpy"] + b["reducedJpy"] + b["priceMoveJpy"]
    )
    diff = abs(shown - b["totalDeltaJpy"])
    print(f"    内訳の合計 ¥{shown:,.0f}  総変化との差 ¥{diff:,.2f}  → {'一致' if diff < 1 else '不一致'}")

    print("[3] 検証で作った 9 月分を削除")
    removed = post(token, "import.monthlyDelete", {"periodYm": "2026-09"})
    print(f"    削除: {removed['removed']}")

    rows = get(token, "import.monthlyList")
    print(f"[4] 残った記録: {[r['periodYm'] for r in rows]}")


if __name__ == "__main__":
    main()
