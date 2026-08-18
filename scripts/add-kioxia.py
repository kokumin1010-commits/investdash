"""キオクシア（285A.T）をウォッチリストに登録し、価格帯プランを生成する。"""

import json
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3000"


def unlock() -> str:
    req = urllib.request.Request(
        BASE + "/api/trpc/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=60))["result"]["data"]["json"]["token"]


def call(token: str, path: str, payload, mutation: bool = False):
    url = BASE + "/api/trpc/" + path
    headers = {"Authorization": "Bearer " + token}
    if mutation:
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            url, data=json.dumps({"json": payload}).encode(), headers=headers
        )
    else:
        if payload is not None:
            url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
        req = urllib.request.Request(url, headers=headers)
    return json.load(urllib.request.urlopen(req, timeout=300))["result"]["data"]["json"]


WATCH_REASON = (
    "NAND フラッシュメモリの大手。AI サーバー向けの高容量 SSD 需要が伸びる局面で"
    "恩恵を受ける立場にある。保有の半導体はロジック・設計・製造装置に寄っており、"
    "記憶装置（メモリ）は持っていないため、同じ AI の流れの中でも別の需給で動く。"
    "予想 PER 7.9 倍と設計系より低い水準にある一方、メモリは価格変動が大きく"
    "業績の振れも大きい。2026/09/29 に 1 株を 3 株にする分割を予定。"
)

BUY_CONDITIONS = (
    "メモリ価格の下落局面では業績が急速に悪化するため、AI 向け高容量 SSD の"
    "出荷が伸び続けているかを決算で確認したうえで打診する。"
    "9/29 の株式分割後は 1 株あたりの価格が約 3 分の 1 になるため、"
    "目標価格は分割後の水準に読み替える必要がある。"
)


def main() -> None:
    token = unlock()

    added = call(
        token,
        "watchlist.add",
        {
            "code": "285A.T",
            "name": "キオクシアホールディングス",
            "targetPrice": 46000,
            "priority": "MEDIUM",
            "watchReason": WATCH_REASON,
            "buyConditions": BUY_CONDITIONS,
        },
        mutation=True,
    )
    print("登録:", json.dumps(added, ensure_ascii=False)[:400])

    rows = call(token, "watchlist.list", None)
    target = None
    for row in rows if isinstance(rows, list) else rows.get("items", []):
        if row.get("symbol") == "285A.T":
            target = row
            break
    if not target:
        print("登録後の取得に失敗")
        return

    print(
        f"現在値 {target.get('currentPrice')} / 目標 {target.get('targetPrice')} / "
        f"乖離 {target.get('gapPct')}"
    )

    plan = call(
        token,
        "portfolio.generateWatchPricePlan",
        {"watchId": target["id"]},
        mutation=True,
    )
    print("プラン生成:", json.dumps(plan, ensure_ascii=False)[:600])


if __name__ == "__main__":
    main()
