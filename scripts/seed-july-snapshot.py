#!/usr/bin/env python3
"""7 月分の月次記録を作る。

7 月に渡されたスクショの元データは残っていない（DB の holdings は 8/14 以降の
登録のみ、upload ディレクトリの最古も 8/13）。したがって 7 月の保有明細は
復元できない。

ここでは「7 月の記録が存在しないこと」を明示するための扱いを決める:
  - 推測で 7 月の明細を作らない。売買を捏造すると 8 月との差分が全部嘘になる
  - 8 月分（実データ）を基準の最初の記録とし、9 月分から差分が出るようにする

このスクリプトは 8 月分の記録が正しく入っているかの確認のみを行う。
"""
import json
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


def query(token: str, proc: str, payload=None):
    url = f"{BASE}/{proc}"
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["result"]["data"]["json"]


def main() -> None:
    import urllib.parse  # noqa: F401  (query 内で使用)

    token = unlock()
    rows = query(token, "import.monthlyList")
    print(f"記録されている月: {len(rows)} 件")
    for r in rows:
        print(
            f"  {r['periodYm']}  評価額 ¥{r['totalValueJpy']:,.0f}  "
            f"銘柄 {r['symbolCount']}  レコード {r['recordCount']}  "
            f"純資産 ¥{(r['netAssetsJpy'] or 0):,.0f}  source={r['source']}"
        )


if __name__ == "__main__":
    import urllib.parse

    main()
