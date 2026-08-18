"""本番の買い増し提案が、件数の内訳と待ち金額を返すかを確認する。"""
import json
import sys
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://investdash-h5pd9fya.manus.space"
# User-Agent が無いと本番の前段で 403 を返される
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"


def unlock() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/trpc/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["result"]["data"]["json"]["token"]


def query(token: str, proc: str, payload=None):
    url = f"{BASE}/api/trpc/{proc}"
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    return d.get("result", {}).get("data", {}).get("json")


def main() -> None:
    token = unlock()
    rows = query(token, "portfolio.addProposals") or []
    buy = [r for r in rows if r.get("stance") == "BUY"]
    wait = [r for r in rows if r.get("stance") == "WAIT"]
    skip = [r for r in rows if r.get("stance") == "SKIP"]
    print(f"提案 {len(rows)} 件 / 買う {len(buy)} / 待つ {len(wait)} / 見送り {len(skip)}")
    for r in buy[:3]:
        print(
            f"  [買う] {r['symbol']} 金額={r.get('amountBase')} 株数={r.get('shares')}"
            f" 指値={r.get('limitPrice')}"
        )
    for r in wait[:4]:
        print(
            f"  [待つ] {r['symbol']} 待ち値={r.get('limitPrice')}"
            f" 到達時金額={r.get('waitAmountBase')} 株数={r.get('waitShares')}"
        )


if __name__ == "__main__":
    main()
