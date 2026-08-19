#!/usr/bin/env python3
"""指定した銘柄が既に保有・ウォッチリストにあるかを確認する。

使い方: python3 scripts/check-symbols.py 9984.T 5801.T ...

登録前に確認するのは、AI の候補提案から一括登録した際に
既に持っている銘柄が混ざることがあるため。
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3000"
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
        return json.load(r)["result"]["data"]["json"]


def norm(code: str) -> str:
    """4桁コード / 285A などを 9984.T 形式に寄せる（比較用）。"""
    c = code.upper().replace(".JP", ".T")
    return c if "." in c else f"{c}.T"


def main() -> None:
    targets = [norm(a) for a in sys.argv[1:]]
    token = unlock()

    overview = get(token, "portfolio.overview")
    holdings = overview["positions"]
    watch = get(token, "watchlist.list")

    held = {}
    for h in holdings:
        held.setdefault(norm(h["symbol"]), []).append(h)
    watched = {norm(w["symbol"]): w for w in watch}

    print(f"保有 {len(holdings)} レコード / ウォッチリスト {len(watch)} 件")
    print("-" * 60)
    for t in targets:
        marks = []
        if t in held:
            rows = held[t]
            qty = sum(float(r["quantity"]) for r in rows)
            brokers = ", ".join(sorted({r["broker"] for r in rows}))
            marks.append(f"保有あり（{qty:g} 株 / {brokers}）")
        if t in watched:
            w = watched[t]
            marks.append(f"ウォッチリスト登録済み（目標 {w.get('targetPrice')}）")
        print(f"{t}: {' / '.join(marks) if marks else '未保有・未登録'}")


if __name__ == "__main__":
    main()
