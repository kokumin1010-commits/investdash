"""キオクシアの価格帯プランの内容を確認する。"""

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


def query(token: str, path: str, payload=None):
    url = BASE + "/api/trpc/" + path
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    return json.load(urllib.request.urlopen(req, timeout=180))["result"]["data"]["json"]


def main() -> None:
    token = unlock()
    plan = query(token, "portfolio.priceBandPlan", {"symbol": "285A.T"})
    print(json.dumps(plan, ensure_ascii=False, indent=2)[:3000])


if __name__ == "__main__":
    main()
