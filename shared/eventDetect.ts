/**
 * 臨時レポートを出すべき出来事を検知する。
 *
 * 決算日そのものは取得できないため（Yahoo Finance の API に含まれず、
 * 日本株・香港株・SG 株では決算に関する項目が 1 つも返らない）、
 * 「決算が出た」「重大な出来事が起きた」ことをニュースから事後に検知する。
 *
 * 純関数として切り出してテストできるようにする。
 */

/** 決算に関するニュースと判断するキーワード */
const EARNINGS_KEYWORDS = [
  // 日本語
  "決算",
  "四半期",
  "通期",
  "業績予想",
  "上方修正",
  "下方修正",
  "増配",
  "減配",
  "無配",
  "自社株買い",
  "営業利益",
  "純利益",
  // 英語
  "earnings",
  "quarterly result",
  "q1 result",
  "q2 result",
  "q3 result",
  "q4 result",
  "full-year result",
  "guidance",
  "profit warning",
  "dividend cut",
  "dividend increase",
  "buyback",
  // 中文
  "業績",
  "季報",
  "年報",
  "派息",
];

/**
 * 臨時レポートを出す基準。
 *
 * 週次レポート（影響度 70 以上）より高くする。臨時は届いた時点で
 * 見てもらう前提なので、頻繁に出すと見なくなる。
 */
export const URGENT_IMPACT_THRESHOLD = 85;

/** 決算ニュースは影響度がやや低くても取り上げる（内容が重要なため） */
export const EARNINGS_IMPACT_THRESHOLD = 70;

export type NewsLike = {
  id: number;
  symbol: string;
  title: string;
  summary: string | null;
  impactScore: number | null;
  sentiment: string | null;
  publishedAt: Date | null;
};

export type DetectedEvent = {
  news: NewsLike;
  /** EARNINGS = 決算関連 / NEWS = それ以外の重大な出来事 */
  kind: "EARNINGS" | "NEWS";
  /** なぜ取り上げるのか */
  reason: string;
};

/** 決算に関するニュースか */
export function isEarningsNews(title: string, summary: string | null): boolean {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  return EARNINGS_KEYWORDS.some(k => text.includes(k.toLowerCase()));
}

/**
 * 臨時レポートの対象となるニュースを選ぶ。
 *
 * @param items 判定対象のニュース
 * @param heldSymbols 保有している銘柄。保有していない銘柄は対象外
 *                    （ウォッチリストの銘柄で臨時レポートを出しても
 *                     持っていないので判断する必要がない）
 */
export function detectUrgentEvents(
  items: NewsLike[],
  heldSymbols: Set<string>
): DetectedEvent[] {
  const events: DetectedEvent[] = [];

  for (const n of items) {
    if (!heldSymbols.has(n.symbol)) continue;
    const impact = n.impactScore ?? 0;
    const earnings = isEarningsNews(n.title, n.summary);

    if (earnings && impact >= EARNINGS_IMPACT_THRESHOLD) {
      events.push({
        news: n,
        kind: "EARNINGS",
        reason: `決算に関する情報（影響度 ${impact}）`,
      });
      continue;
    }

    if (impact >= URGENT_IMPACT_THRESHOLD) {
      events.push({
        news: n,
        kind: "NEWS",
        reason: `影響度が高い（${impact}）`,
      });
    }
  }

  /*
   * 同じ銘柄で複数該当した場合は影響度が最も高いものだけを残す。
   * 1 つの決算で「速報」「詳報」「解説」と 3 本出ることがあり、
   * そのまま出すと 3 通届いて読まれなくなる。
   */
  const bySymbol = new Map<string, DetectedEvent>();
  for (const e of events) {
    const cur = bySymbol.get(e.news.symbol);
    if (!cur) {
      bySymbol.set(e.news.symbol, e);
      continue;
    }
    const curImpact = cur.news.impactScore ?? 0;
    const newImpact = e.news.impactScore ?? 0;
    /*
     * 決算を優先する。影響度が同程度なら、決算の方が
     * 「想定が崩れたか」の判断に直結する。
     */
    if (e.kind === "EARNINGS" && cur.kind !== "EARNINGS") {
      bySymbol.set(e.news.symbol, e);
    } else if (e.kind === cur.kind && newImpact > curImpact) {
      bySymbol.set(e.news.symbol, e);
    }
  }

  return Array.from(bySymbol.values()).sort(
    (a, b) => (b.news.impactScore ?? 0) - (a.news.impactScore ?? 0)
  );
}
