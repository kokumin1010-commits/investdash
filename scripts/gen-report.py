"""週次レポートを生成して内容を確認する。

提案と実績がレポート本文に反映されているかを目視で確かめるために使う。
"""
import json
import subprocess
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
DAYS = int(sys.argv[2]) if len(sys.argv) > 2 else 7


def unlock() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/trpc/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)["result"]["data"]["json"]["token"]


def main() -> None:
    token = unlock()
    req = urllib.request.Request(
        f"{BASE}/api/trpc/portfolio.generateWeeklyReport",
        data=json.dumps({"json": {"days": DAYS}}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    res = d.get("result", {}).get("data", {}).get("json")
    if res is None:
        print(json.dumps(d, ensure_ascii=False)[:600])
        return
    print("見出し:", res.get("headline"))
    print("判断件数:", res.get("actionCount"))
    body = res.get("body") or ""
    print("本文", len(body), "文字")
    print("-" * 60)
    print(body)


if __name__ == "__main__":
    main()
