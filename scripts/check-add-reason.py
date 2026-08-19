"""ADD 銘柄の買い増し理由が実データで出ているかを確認する。"""

import json
import subprocess
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3000"
HEADERS = {"Content-Type": "application/json", "User-Agent": "curl/8.5.0"}


def unlock() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/trpc/auth.unlock",
        data=json.dumps({"json": {"passcode": "1010"}}).encode(),
        headers=HEADERS,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["result"]["data"]["json"]["token"]


def query(path: str, token: str, payload: dict | None = None) -> dict:
    url = f"{BASE}/api/trpc/{path}"
    if payload is not None:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    req = urllib.request.Request(url, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["result"]["data"]["json"]


def main() -> None:
    token = unlock()
    data = query("portfolio.overview", token, {})
    groups = data["groups"]
    add = [g for g in groups if g.get("addPlan")]
    with_reason = [g for g in add if g["addPlan"].get("reason", {}).get("points")]
    at_cap = [g for g in add if g["addPlan"]["atCap"]]

    print(f"ADD 銘柄: {len(add)} 件 / 理由あり: {len(with_reason)} 件 / 上限到達: {len(at_cap)} 件")
    print()
    for g in add[:6]:
        plan = g["addPlan"]
        print(f"■ {g['name']} ({g['tickerCode']})")
        if plan["atCap"]:
            print("  上限到達（理由なし）")
        else:
            amt = plan.get("amountLocal")
            print(f"  金額 {amt} / {plan.get('shares')} 株")
            for p in plan.get("reason", {}).get("points", []):
                print(f"  ○ {p}")
            for c in plan.get("reason", {}).get("cautions", []):
                print(f"  △ {c}")
        print()


if __name__ == "__main__":
    main()
