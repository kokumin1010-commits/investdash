"""本番でバフェット式の判定（今から買うか・価格と中身の伸び）が返るか確認する。"""

import json
import urllib.parse
import urllib.request

BASE = "https://investdash-h5pd9fya.manus.space"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"


def unlock() -> str:
    req = urllib.request.Request(
        BASE + "/api/trpc/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA},
    )
    body = json.load(urllib.request.urlopen(req, timeout=60))
    return body["result"]["data"]["json"]["token"]


def query(token: str, path: str, payload=None):
    url = BASE + "/api/trpc/" + path
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(
        url, headers={"Authorization": "Bearer " + token, "User-Agent": UA}
    )
    return json.load(urllib.request.urlopen(req, timeout=120))["result"]["data"]["json"]


def main() -> None:
    token = unlock()
    overview = query(token, "portfolio.overview", {"baseCurrency": "JPY"})
    groups = overview["groups"]
    print(f"銘柄数: {len(groups)}")

    with_lens = [g for g in groups if (g.get("signal") or {}).get("wouldBuyNow")]
    print(f"「今から買うか」の判定が入っている銘柄: {len(with_lens)} 件")

    for group in with_lens[:12]:
        signal = group["signal"]
        print(
            f"  {group['symbol']:<10} {signal['action']:<6} "
            f"buyNow={signal.get('wouldBuyNow'):<8} "
            f"priceVsValue={signal.get('priceVsValue')}"
        )
        reason = (signal.get("wouldBuyNowReason") or "").replace("\n", " ")
        if reason:
            print(f"    理由: {reason[:110]}")


if __name__ == "__main__":
    main()
