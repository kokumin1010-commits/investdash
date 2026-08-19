#!/usr/bin/env python3
"""ウォッチリスト 1 件の登録内容と価格帯プランを読みやすく表示する。

使い方: python3 scripts/check-watch-item.py 9984.T [BASE_URL]
"""
import json
import sys
import urllib.parse
import urllib.request

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "9984.T"
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
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
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        body = json.load(r)
    if "error" in body:
        raise RuntimeError(body["error"]["json"]["message"])
    return body["result"]["data"]["json"]


def main() -> None:
    token = unlock()
    items = get(token, "watchlist.list")
    item = next((w for w in items if w["symbol"] == SYMBOL), None)
    if item is None:
        print(f"{SYMBOL} はウォッチリストにない（全 {len(items)} 件）")
        return

    print(f"ウォッチリスト {len(items)} 件中の {SYMBOL}")
    print(f"  銘柄名: {item['name']}")
    print(f"  現在値: {item.get('currentPrice')} {item.get('currency')}")
    print(f"  目標価格: {item.get('targetPrice')}")
    print(f"  優先度: {item.get('priority')}")
    print(f"  業種 / 産業: {item.get('sector')} / {item.get('industry')}")
    print(f"  目標までの距離判定: {item.get('targetLevel')} {item.get('targetNote') or ''}")
    print(f"  作り直し対象: {item.get('targetNeedsRework')}")
    print(f"  既に保有: {item.get('held') is not None if 'held' in item else 'n/a'}")

    plan = get(token, "portfolio.priceBandPlan", {"symbol": SYMBOL})
    if plan is None:
        print("  価格帯プラン: 未生成")
        return
    print(f"  価格帯プラン: {len(plan['bands'])} 段（{plan['model']}）")
    for b in plan["bands"]:
        lo = b["lowerPrice"]
        hi = b["upperPrice"]
        rng = (
            f"{lo:,.0f} 以上" if hi is None else
            f"{hi:,.0f} 以下" if lo is None else
            f"{lo:,.0f}〜{hi:,.0f}"
        )
        print(f"    [{b['action']}] {rng} — {b['actionLabel']}")
        checks = b.get("checks") or b.get("checkItems") or []
        for c in checks:
            label = c["label"] if isinstance(c, dict) else c
            print(f"        ・{label}")


if __name__ == "__main__":
    main()
