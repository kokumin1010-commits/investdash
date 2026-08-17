/**
 * 銘柄メモに積む出来事を選び、1 行の記録に整える。
 *
 * 【なぜ必要か】
 * ニュース・判定変化・相談はそれぞれ別の場所に溜まっていて、
 * 「この銘柄に何が起きてきたか」を一本の時系列で読めなかった。
 * 相談 AI も直近のニュースしか見ないため、3 か月前の決算での
 * 下方修正を踏まえずに答えてしまう。
 *
 * 【AI を通さない】
 * 出来事の記録に AI を使うと 112 銘柄 × 毎日で費用と時間がかかり、
 * 要約の過程で数値が変わる恐れもある。既にある情報をそのまま写す。
 * 解釈が必要な場面（相談・レポート）でまとめて AI に渡す。
 */
import { isEarningsNews } from "./eventDetect";

export type NoteKind = "NEWS" | "EARNINGS" | "BAND" | "CONSULT" | "OUTCOME" | "MANUAL";

export type NoteDraft = {
  symbol: string;
  kind: NoteKind;
  headline: string;
  detail: string | null;
  importance: number | null;
  occurredAt: Date;
  /** 同じ出来事を二重に積まないための鍵 */
  sourceKey: string;
};

/**
 * メモに残すニュースの下限。
 *
 * すべてのニュースを積むと 112 銘柄 × 毎日で埋まり、
 * 後から読み返したときに重要な出来事が埋もれる。
 * 週次レポートの基準（70）より低くする。レポートは「今週見るべきこと」だが、
 * メモは「後から経緯を辿るため」なので、やや広く残した方がよい。
 */
export const NOTE_NEWS_THRESHOLD = 50;

/** 決算関連はこれを下げる。内容が判断に直結するため */
export const NOTE_EARNINGS_THRESHOLD = 35;

export type NewsForNote = {
  id: number;
  symbol: string;
  title: string;
  summary: string | null;
  impactScore: number | null;
  publishedAt: Date | null;
  createdAt: Date;
};

/**
 * ニュースからメモを作る。
 *
 * 影響度が未取得のものは残さない。未分析のニュースを積むと、
 * 重要度が分からないまま並び、上位を選ぶときに判断できない。
 */
export function noteFromNews(n: NewsForNote): NoteDraft | null {
  const impact = n.impactScore ?? null;
  if (impact === null) return null;
  const earnings = isEarningsNews(n.title, n.summary);
  const threshold = earnings ? NOTE_EARNINGS_THRESHOLD : NOTE_NEWS_THRESHOLD;
  if (impact < threshold) return null;
  return {
    symbol: n.symbol,
    kind: earnings ? "EARNINGS" : "NEWS",
    headline: n.title.slice(0, 500),
    // 要約はそのまま写す。AI に再要約させると数値が変わる恐れがある
    detail: n.summary ? n.summary.slice(0, 2000) : null,
    importance: impact,
    // 公開日が無いニュースもあるため取得日で代替する
    occurredAt: n.publishedAt ?? n.createdAt,
    sourceKey: `news:${n.id}`,
  };
}

export type BandTransitionForNote = {
  id: number;
  symbol: string;
  fromLabel: string | null;
  toLabel: string | null;
  fromAction: string | null;
  toAction: string | null;
  outsideDirection: string | null;
  price: string | number | null;
  currency: string | null;
  createdAt: Date;
};

/**
 * 判定変化からメモを作る。
 *
 * 「静観 → 打診買い」のような段の移動をそのまま書く。
 * 判定が変わった時点が「いつ買い場に入ったか」の記録になる。
 */
export function noteFromBandTransition(t: BandTransitionForNote): NoteDraft {
  const from = t.fromLabel ?? (t.fromAction ? t.fromAction : "記録なし");
  const to =
    t.toLabel ??
    (t.outsideDirection === "ABOVE"
      ? "価格帯より上（対象外）"
      : t.outsideDirection === "BELOW"
        ? "価格帯より下（想定を超える下落）"
        : "記録なし");
  const price = t.price !== null ? Number(t.price) : null;
  /*
   * 重要度は「要判断かどうか」で決める。買い増し圏・減らす圏に入った
   * 場合は行動が必要なので高く、静観に戻った場合は参考に落とす。
   * 相談 AI に上位だけを渡すときの並び順に使う。
   */
  const actionable = t.toAction === "ADD_SMALL" || t.toAction === "ADD_MAIN" || t.toAction === "REDUCE";
  return {
    symbol: t.symbol,
    kind: "BAND",
    headline: `買い増しプランの判定が「${from}」から「${to}」に変わった`,
    detail:
      price !== null
        ? `そのときの株価: ${t.currency && t.currency !== "JPY" && t.currency !== "USD" ? `${t.currency} ` : ""}${price.toLocaleString("ja-JP")}`
        : null,
    importance: actionable ? 75 : 40,
    occurredAt: t.createdAt,
    sourceKey: `band:${t.id}`,
  };
}

export type ConsultForNote = {
  id: number;
  symbol: string | null;
  title: string;
  /** 相談の結論（回答の冒頭） */
  conclusion: string | null;
  createdAt: Date;
};

/**
 * 相談からメモを作る。
 *
 * 銘柄を指定していない相談（全体の方針など）は対象外。
 * 特定の銘柄のメモとして積むと関係ない銘柄に混ざる。
 */
export function noteFromConsult(c: ConsultForNote): NoteDraft | null {
  if (!c.symbol) return null;
  return {
    symbol: c.symbol,
    kind: "CONSULT",
    headline: `AI に相談した: ${c.title.slice(0, 400)}`,
    detail: c.conclusion ? c.conclusion.slice(0, 2000) : null,
    // 自分が判断した記録なので、ニュースより高く扱う
    importance: 80,
    occurredAt: c.createdAt,
    sourceKey: `consult:${c.id}`,
  };
}

export type OutcomeForNote = {
  id: number;
  symbol: string;
  stance: string;
  verdict: string;
  priceAtAdvice: string | number | null;
  priceAtVerdict: string | number | null;
  verdictAt: Date | null;
  createdAt: Date;
};

const STANCE_LABELS: Record<string, string> = {
  BUY: "買い",
  HOLD: "見送り",
  REDUCE: "売却・縮小",
  REPAY: "借入返済",
};

const VERDICT_LABELS: Record<string, string> = {
  CORRECT: "結果的に正しかった",
  WRONG: "結果的に外れた",
};

/**
 * 提案の当否からメモを作る。
 *
 * 判定が確定したものだけ残す。判定待ちを積むと「まだ分からない」記録が
 * 並び、経緯を読むときの邪魔になる。
 */
export function noteFromOutcome(o: OutcomeForNote): NoteDraft | null {
  const verdictLabel = VERDICT_LABELS[o.verdict];
  if (!verdictLabel) return null;
  const stance = STANCE_LABELS[o.stance] ?? o.stance;
  const from = o.priceAtAdvice !== null ? Number(o.priceAtAdvice) : null;
  const to = o.priceAtVerdict !== null ? Number(o.priceAtVerdict) : null;
  const move =
    from !== null && to !== null && from > 0
      ? `株価 ${from.toLocaleString("ja-JP")} → ${to.toLocaleString("ja-JP")}（${(((to - from) / from) * 100).toFixed(1)}%）`
      : null;
  return {
    symbol: o.symbol,
    kind: "OUTCOME",
    headline: `「${stance}」の判断が${verdictLabel}`,
    detail: move,
    importance: 70,
    occurredAt: o.verdictAt ?? o.createdAt,
    sourceKey: `outcome:${o.id}`,
  };
}

/**
 * 相談 AI に渡すメモを選ぶ。
 *
 * 全件渡すとトークンを食い尽くして本題が埋もれる。
 * 「新しい」だけで選ぶと 3 か月前の決算での下方修正が落ちるため、
 * 重要度が高いものと新しいものの両方を残す。
 */
export function selectNotesForPrompt<
  T extends { importance: number | null; occurredAt: Date; kind: NoteKind },
>(notes: T[], limit = 12): T[] {
  if (notes.length <= limit) {
    return [...notes].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }
  /*
   * 半分を「新しい順」、残りを「重要度が高い順」で埋める。
   * 重要度だけで選ぶと直近の出来事が落ち、新しさだけで選ぶと
   * 過去の決算や自分の判断が落ちる。
   */
  const recentCount = Math.ceil(limit / 2);
  const byRecent = [...notes].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const picked = new Set<T>(byRecent.slice(0, recentCount));
  const byImportance = [...notes].sort((a, b) => {
    const d = (b.importance ?? 0) - (a.importance ?? 0);
    if (d !== 0) return d;
    return b.occurredAt.getTime() - a.occurredAt.getTime();
  });
  for (const n of byImportance) {
    if (picked.size >= limit) break;
    picked.add(n);
  }
  return Array.from(picked).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
