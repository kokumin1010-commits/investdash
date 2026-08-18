#!/usr/bin/env python3
"""バフェット式の判断軸を入れたシグナル判定を実データで確認する。

性質の異なる銘柄を選んで、判定が銘柄ごとに変わるかを見る。
全部同じ答えになるなら、渡した材料が判定に効いていない。
"""
import json
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3000/api/trpc"


def unlock() -> str:
    req = urllib.request.Request(
        f"{BASE}/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)["result"]["data"]["json"]["token"]


def query(token: str, path: str, payload=None):
    url = f"{BASE}/{path}"
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["result"]["data"]["json"]


def mutate(token: str, path: str, payload):
    req = urllib.request.Request(
        f"{BASE}/{path}",
        data=json.dumps({"json": payload}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["result"]["data"]["json"]


def main() -> int:
    import urllib.parse  # noqa: F401  (query 内で使う)

    token = unlock()
    ov = query(token, "portfolio.overview")
    groups = ov["groups"]

    # 性質の異なる銘柄を選ぶ。
    # - 大きく育った銘柄（価格が中身より速い可能性）
    # - 下がっている銘柄（安いだけか、安い理由があるか）
    # - 設備集約型（半導体・エネルギー）
    # - 追加資本の少ない型（ソフトウェア・ブランド）
    wanted = ["NVDA", "AVGO", "7203.T", "0823.HK", "KO", "INTC", "ORCL", "DIS"]
    picks = []
    for sym in wanted:
        g = next((x for x in groups if x["symbol"] == sym), None)
        if g:
            picks.append(g)
    if not picks:
        print("対象銘柄が見つかりません", file=sys.stderr)
        return 1

    print(f"対象 {len(picks)} 銘柄でシグナルを再生成します\n")
    for g in picks:
        # 保有レコードの id が必要。entries の先頭を使う
        hid = g["entries"][0]["id"]
        t0 = time.time()
        try:
            r = mutate(token, "portfolio.regenerateSignal", {"id": hid})
        except Exception as e:  # noqa: BLE001
            print(f"[{g['symbol']}] 失敗: {e}\n")
            continue
        dt = time.time() - t0
        print(f"===== {g['name']} ({g['symbol']}) — {dt:.1f}秒")
        print(f"  シグナル: {r['action']} / 確信度 {r['confidence']}")
        print(f"  今から買うか: {r.get('wouldBuyNow')} — {r.get('wouldBuyNowReason')}")
        print(f"  価格と価値: {r.get('priceVsValue')} — {r.get('priceVsValueReason')}")
        print(f"  根拠: {r['rationale'][:300]}")
        print()

    return 0


if __name__ == "__main__":
    import urllib.parse

    sys.exit(main())
