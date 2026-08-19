#!/usr/bin/env python3
"""ソフトバンクグループ（9984.T）をウォッチリストに登録し、価格帯プランを作る。

登録前に株価が取れるかを lookup で確かめる。取れない銘柄コードで登録すると
目標価格まで届いたかの判定が永久に動かず、待っているつもりで
実質「買わない」状態になる。
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


def call(token: str, proc: str, payload=None, method="POST"):
    url = f"{API}/{proc}"
    data = None
    headers = {"Authorization": f"Bearer {token}", "User-Agent": UA}
    if method == "GET":
        if payload is not None:
            url += "?input=" + urllib.parse.quote(json.dumps({"json": payload}))
    else:
        data = json.dumps({"json": payload if payload is not None else {}}).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=240) as r:
        body = json.load(r)
    if "error" in body:
        raise RuntimeError(body["error"]["json"]["message"])
    return body["result"]["data"]["json"]


REASON = (
    "【なぜ見るか】保有の情報技術は半導体の設計・製造装置・クラウドに寄っており、"
    "AI 分野への投資そのものを事業にしている会社を持っていない。"
    "ソフトバンクグループは Arm（半導体設計の基盤・IPO 済み）と OpenAI への出資を"
    "通じて AI の上流を押さえており、保有する NVDA・AVGO・ASML などとは"
    "別の形で同じ流れに乗る。"
    "\n【今の位置】8/19 時点 5,483 円（前日比 -5.95%）。52 週高値 9,074 円に対して"
    "39.6% 下、52 週安値 3,365 円からは 63% 上。予想 PER 19.53 倍・PBR 1.77 倍。"
    "\n【懸念】この会社の株価は保有資産（Arm・OpenAI・ビジョンファンド）の評価額で動くため、"
    "AI 関連株が下がると保有資産の評価と株価が同時に下がり、下落幅が個別株より大きくなる。"
    "8/19 の -5.95% も日経平均 -2.82% の 2 倍以上動いており、半導体株が総崩れした日の"
    "影響を増幅して受ける性質がある。既に情報技術が構成比 30% を超えレバレッジ 1.18 倍が"
    "かかっている状態では、同じ材料で動く銘柄をこれ以上増やすと下落時の耐性が落ちる。"
    "\n【配当は期待しない】予想配当 11 円・利回り 0.20%。現金性資産の利回り 3.46% や"
    "借入金利 1.73% を大きく下回るため、現金を置き換える先としては不利。"
    "値上がりだけを狙う銘柄として扱う。"
)

CONDITION = (
    "52 週高値 9,074 円から 4 割下の 5,400 円台は既に安値圏だが、"
    "資産評価で動く銘柄は下げ始めると止まりにくいため一度に買わない。"
    "\n・4,700 円（52 週安値と現在値の中間）までは打診買いにとどめる"
    "\n・Arm の四半期決算でロイヤリティ収入の伸びが鈍っていないことを確認する"
    "（この会社の価値の大半が Arm の評価で決まる）"
    "\n・NAV（保有資産の純資産価値）に対する株価の割引率を確認する。"
    "割引率が縮んでいる局面での買いは避ける"
    "\n・OpenAI 関連の出資額が自己資本に対して過大になっていないかを見る"
    "\n・9/29 が配当の権利落ち日（1 株 5.5 円）。配当目的ではないため権利取りは狙わない"
)


def main() -> None:
    token = unlock()

    print("[1] 株価が取れるか確認（9984.T）")
    look = call(token, "portfolio.lookup", {"code": "9984.T"})
    print(f"    {json.dumps(look, ensure_ascii=False)[:400]}")
    price = look.get("price") or look.get("currentPrice")
    if not price:
        print("    株価が取れないため中止")
        sys.exit(1)

    target = 4700
    print(f"[2] ウォッチリストに登録（現在値 {price} / 目標 {target}）")
    added = call(
        token,
        "watchlist.add",
        {
            "code": "9984.T",
            "name": "ソフトバンクグループ",
            "targetPrice": target,
            "priority": "MEDIUM",
            "watchReason": REASON,
            "buyConditions": CONDITION,
        },
    )
    print(f"    {json.dumps(added, ensure_ascii=False)[:300]}")

    print("[3] 価格帯プランを生成")
    plan = call(token, "portfolio.generateWatchPricePlan", {"symbol": "9984.T"})
    print(f"    {json.dumps(plan, ensure_ascii=False)[:1500]}")


if __name__ == "__main__":
    main()
