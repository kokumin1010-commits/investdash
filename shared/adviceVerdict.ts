/**
 * 提案が当たったか外れたかを株価の推移から判定する。
 *
 * なぜ AI に判定させないか:
 * 自分の過去の発言を評価させると甘くなる。「方向性としては正しかった」
 * のような曖昧な擁護が入り、実績として使えない。株価という外部の
 * 事実だけで機械的に決める。
 *
 * 判定の考え方（長期保有・配当重視という使い方に合わせる）:
 * - BUY を勧めた → その後上がっていれば正しい（安く買えた）
 * - HOLD（見送り）を勧めた → その後下がっていれば正しい（高値で買わずに済んだ）
 * - REDUCE（売却）を勧めた → その後下がっていれば正しい（高値で売れた）
 *
 * 短期の値動きで判定しないよう、最低の経過日数と最低の変動幅を設ける。
 * 3 日で 1% 動いただけで「当たった」と数えると、実績が偶然の羅列になる。
 */

export type AdviceVerdict = "CORRECT" | "WRONG" | "UNCLEAR";

/** 判定を始めるまでの最低日数。これ未満は経過が足りず判定しない */
export const MIN_DAYS_FOR_VERDICT = 30;

/**
 * 当否を分ける最低の変動幅（%）。
 *
 * これ未満の動きは「ほぼ横ばい」として UNCLEAR にする。
 * 5% にしているのは、株価の日々の揺れがこの程度には収まり、
 * かつ長期の判断としては意味のある差になる水準のため。
 */
export const MIN_MOVE_PCT = 5;

export type VerdictInput = {
  stance: "BUY" | "HOLD" | "REDUCE" | "REPAY";
  priceAtAdvice: number | null;
  priceNow: number | null;
  daysElapsed: number;
};

export type VerdictResult = {
  verdict: AdviceVerdict;
  /** 提案時からの変動率（%）。判定できないときは null */
  changePct: number | null;
  /** なぜその判定になったか。画面にそのまま出す */
  reason: string;
};

export function judgeAdvice(input: VerdictInput): VerdictResult {
  const { stance, priceAtAdvice, priceNow, daysElapsed } = input;

  /*
   * 借入の返済を勧めた提案は株価と結びつかないので判定しない。
   * 金利と利回りの比較で当否を決めるべきだが、それは別の話なので
   * ここでは対象外として明示する。
   */
  if (stance === "REPAY") {
    return {
      verdict: "UNCLEAR",
      changePct: null,
      reason: "借入の判断は株価では測れないため対象外です",
    };
  }

  if (priceAtAdvice === null || priceNow === null || priceAtAdvice <= 0) {
    return {
      verdict: "UNCLEAR",
      changePct: null,
      reason: "提案時または現在の株価が取得できていません",
    };
  }

  if (daysElapsed < MIN_DAYS_FOR_VERDICT) {
    return {
      verdict: "UNCLEAR",
      changePct: ((priceNow - priceAtAdvice) / priceAtAdvice) * 100,
      reason: `提案から ${daysElapsed} 日しか経っていません（${MIN_DAYS_FOR_VERDICT} 日以上で判定）`,
    };
  }

  const changePct = ((priceNow - priceAtAdvice) / priceAtAdvice) * 100;

  if (Math.abs(changePct) < MIN_MOVE_PCT) {
    return {
      verdict: "UNCLEAR",
      changePct,
      reason: `株価がほぼ横ばい（${changePct.toFixed(1)}%）で当否を分けられません`,
    };
  }

  const rose = changePct > 0;

  if (stance === "BUY") {
    return rose
      ? {
          verdict: "CORRECT",
          changePct,
          reason: `買いを勧めた後 ${changePct.toFixed(1)}% 上昇しました`,
        }
      : {
          verdict: "WRONG",
          changePct,
          reason: `買いを勧めた後 ${changePct.toFixed(1)}% 下落しました`,
        };
  }

  /*
   * HOLD（見送り）と REDUCE（売却）はどちらも「今は買わない・減らす」
   * 方向なので、その後下がっていれば正しかったことになる。
   */
  return rose
    ? {
        verdict: "WRONG",
        changePct,
        reason: `見送りを勧めた後 ${changePct.toFixed(1)}% 上昇しました（買う機会を逃しました）`,
      }
    : {
        verdict: "CORRECT",
        changePct,
        reason: `見送りを勧めた後 ${changePct.toFixed(1)}% 下落しました`,
      };
}

/**
 * 提案の実績を集計する。相談の前提に入れて AI 自身に踏まえさせる。
 */
export function summarizeVerdicts(
  rows: { stance: string; verdict: string | null }[]
): {
  total: number;
  judged: number;
  correct: number;
  wrong: number;
  byStance: { stance: string; correct: number; wrong: number }[];
} {
  let correct = 0;
  let wrong = 0;
  const map = new Map<string, { correct: number; wrong: number }>();
  for (const r of rows) {
    if (r.verdict !== "CORRECT" && r.verdict !== "WRONG") continue;
    const cur = map.get(r.stance) ?? { correct: 0, wrong: 0 };
    if (r.verdict === "CORRECT") {
      correct += 1;
      cur.correct += 1;
    } else {
      wrong += 1;
      cur.wrong += 1;
    }
    map.set(r.stance, cur);
  }
  return {
    total: rows.length,
    judged: correct + wrong,
    correct,
    wrong,
    byStance: Array.from(map.entries()).map(([stance, v]) => ({ stance, ...v })),
  };
}
