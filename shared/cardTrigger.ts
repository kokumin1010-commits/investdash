/**
 * 投資カードを「今作るべき銘柄」を選ぶ。
 *
 * 【なぜ全件生成しないのか】
 * 112 銘柄を機械的に埋めると 40 分以上かかり、しかもその時点で
 * 材料のない銘柄は一般論だけのカードになる。カードの目的は
 * 「株が下がったとき、当初の想定が崩れたのか単に下がっただけかを
 * 区別する」ことなので、判断が必要になった瞬間にその時点の情報で
 * 作られた方が正確。
 *
 * 【いつ作るのか】
 * 1. 買い増しプランの判定が買い増し圏／減らす圏に入った
 *    → 実際に買うか決める場面。降りる条件が無いまま買うと、
 *      次に下がったときに判断の基準がない。
 * 2. 決算が出た
 *    → 想定が崩れたかを確認する場面。カードの前提と比べる必要がある。
 * 3. 影響度の高いニュースが出た
 *    → 事業の実態が変わった可能性がある。
 *
 * 純関数として切り出し、DB を触らずにテストできるようにする。
 */

/** 重大ニュースと見なす影響度。臨時レポート（85）より低く、週次（70）と揃える */
export const CARD_NEWS_IMPACT = 70;

export type CardCandidate = {
  symbol: string;
  /** カードが空か（既に書かれているなら作らない） */
  cardEmpty: boolean;
  /** 円換算の評価額。金額の大きい順に処理する */
  valueJpy: number;
  /** 買い増しプランの判定 */
  bandAction: string | null;
  /** 直近に決算ニュースがあったか */
  hasEarningsNews: boolean;
  /** 直近の最大影響度 */
  maxImpact: number | null;
};

export type CardTriggerReason = "BAND" | "EARNINGS" | "NEWS";

export type CardTarget = {
  symbol: string;
  reason: CardTriggerReason;
  valueJpy: number;
};

/**
 * カードを作るべき銘柄を選ぶ。
 *
 * 理由の優先順位は BAND → EARNINGS → NEWS。
 * 判定が買い増し圏に入っている銘柄は「今まさに買うか決める」場面なので
 * 最優先。決算はその次（想定が崩れたかの確認）。
 */
export function selectCardTargets(
  candidates: CardCandidate[],
  limit: number
): { targets: CardTarget[]; remaining: number } {
  const picked: CardTarget[] = [];

  for (const c of candidates) {
    // 既に書かれているカードは作り直さない。手で直した内容が消える
    if (!c.cardEmpty) continue;

    const actionable =
      c.bandAction === "ADD_SMALL" || c.bandAction === "ADD_MAIN" || c.bandAction === "REDUCE";
    if (actionable) {
      picked.push({ symbol: c.symbol, reason: "BAND", valueJpy: c.valueJpy });
      continue;
    }
    if (c.hasEarningsNews) {
      picked.push({ symbol: c.symbol, reason: "EARNINGS", valueJpy: c.valueJpy });
      continue;
    }
    if ((c.maxImpact ?? 0) >= CARD_NEWS_IMPACT) {
      picked.push({ symbol: c.symbol, reason: "NEWS", valueJpy: c.valueJpy });
    }
  }

  /*
   * 理由の優先度が同じなら評価額の大きい順。
   * 金額の大きい銘柄ほど判断を誤ったときの影響が大きい。
   */
  const order: Record<CardTriggerReason, number> = { BAND: 0, EARNINGS: 1, NEWS: 2 };
  picked.sort((a, b) => {
    const d = order[a.reason] - order[b.reason];
    if (d !== 0) return d;
    return b.valueJpy - a.valueJpy;
  });

  return {
    targets: picked.slice(0, limit),
    remaining: Math.max(0, picked.length - limit),
  };
}

export const CARD_TRIGGER_LABELS: Record<CardTriggerReason, string> = {
  BAND: "買い増し圏に入った",
  EARNINGS: "決算が出た",
  NEWS: "重大なニュースが出た",
};
