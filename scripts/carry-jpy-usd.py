"""日本円を借りて米ドルで利息を得る（円キャリー）場合の損益を、実データで計算する。

目的は「やるべきか」を数字で確かめること。金利差だけを見ると必ず有利に見えるが、
為替が円高に振れた分は借入の返済額（円建て）に対して損失になるため、
その損益分岐点を出す。
"""

# IBKR 公式（2026/8/19 時点）
JPY_BORROW_TIERS = [
    # (上限, 年率%) IBKR Pro。ブレンド金利のため段階ごとに適用される
    (11_000_000, 2.443),
    (114_000_000, 1.943),
    (5_700_000_000, 1.693),
    (23_000_000_000, 1.443),
]
USD_CASH_RATE = 3.130  # IBKR の USD 現金受取（BM - 0.5%、NAV 10 万ドル超）
USD_CASH_FREE = 10_000  # 最初の 1 万ドルは無利息
SGOV_YIELD = 3.60  # SGOV の 30 日 SEC 利回り（2026/8/14 時点）
SGOV_EXPENSE = 0.09  # SGOV の経費率
TBILL_3M = 3.82  # 米 3 か月国債利回り（2026/8 時点）

# 実データ（DB より）
JPY_BORROWED = 228_720_494.5  # IBKR の日本円借入
USD_JPY = 159.31
FUTU_MMF_RATE = 3.40  # 富途香港の貨幣市場基金


def blended_borrow_rate(amount: float) -> float:
    """借入額に対する加重平均の借入金利（%）を返す。

    IBKR は段階ごとに異なる金利を適用するため、単純に最上位の金利を使うと
    実際より高く（または低く）出る。
    """
    remaining = amount
    prev_cap = 0.0
    weighted = 0.0
    for cap, rate in JPY_BORROW_TIERS:
        if remaining <= 0:
            break
        band = min(remaining, cap - prev_cap)
        weighted += band * rate
        remaining -= band
        prev_cap = cap
    if remaining > 0:  # 最上位より上はすべて最終段の金利
        weighted += remaining * JPY_BORROW_TIERS[-1][1]
    return weighted / amount


def main() -> None:
    print("=" * 62)
    print("日本円を借りて米ドルで利息を得る場合の計算（2026/8/19 時点）")
    print("=" * 62)

    # 1) 現在の借入金利
    cur_rate = blended_borrow_rate(JPY_BORROWED)
    print(f"\n【現在の借入】JPY {JPY_BORROWED:,.0f}（約 ${JPY_BORROWED / USD_JPY:,.0f}）")
    print(f"  加重平均の借入金利: {cur_rate:.3f}%")
    print(f"  年間の金利負担: JPY {JPY_BORROWED * cur_rate / 100:,.0f}")

    # 2) 追加で借りる場合の限界金利（既に上位の段に達しているため）
    for extra in (4_000_000, 20_000_000, 50_000_000):
        after = blended_borrow_rate(JPY_BORROWED + extra)
        marginal = (
            (JPY_BORROWED + extra) * after - JPY_BORROWED * cur_rate
        ) / extra
        usd = extra / USD_JPY
        print(f"\n【追加で JPY {extra:,.0f}（${usd:,.0f}）借りる場合】")
        print(f"  この追加分に実際にかかる金利（限界金利）: {marginal:.3f}%")
        for name, yld in (
            ("IBKR の USD 現金", USD_CASH_RATE),
            ("SGOV（経費差引後）", SGOV_YIELD - SGOV_EXPENSE),
            ("米 3 か月国債", TBILL_3M),
            ("富途 現金宝（USD MMF）", FUTU_MMF_RATE),
        ):
            spread = yld - marginal
            annual_usd = usd * spread / 100
            # 損益分岐の円高幅: 金利差が為替差で消える水準
            print(
                f"    {name:<22} 利回り {yld:.2f}% → 差 {spread:+.2f}%"
                f" / 年 ${annual_usd:,.0f}"
                f" / 円高 {spread:.2f}% (USDJPY {USD_JPY * (1 - spread / 100):.2f}) で消える"
            )


if __name__ == "__main__":
    main()
