/**
 * 配当の計算ロジック。
 *
 * Yahoo Finance から取得した配当の支払履歴をもとに、
 * 1 株あたりの年間配当（直近 12 か月の実績）を求める。
 *
 * ## 株式分割について
 *
 * Yahoo の配当額は**株価と同じく分割調整済み**である（実測で確認）。
 * 住友商事（2026-06-29 に 4:1 分割）で、分割前の配当額と調整済み株価の比が
 * 半期利回り 1.3〜2.0% という妥当な水準に収まることを確認した。
 * したがって分割補正は**行わない**。
 *
 * 補正用の関数（splitFactorAfter / adjustDividend）は残してあるが、
 * これは Yahoo の仕様が将来変わった場合に備えたもので、既定では使わない。
 * 詳細は docs/dividend-data-source.md を参照。
 *
 * ## 特別配当について
 *
 * 分割ではなく特別配当（記念配当）によって 1 回だけ配当が大きくなることがある。
 * 例: 日本製鉄の 2025-09-29 は 60 円で、他の期の 12〜16 円に対して突出している。
 * これは事実の実績なので額は変えないが、「来年も同額もらえる」と
 * 誤解しないよう検出してフラグを立てる。
 */

/** 配当の支払 1 回分 */
export type DividendEvent = {
  /** 権利落ち日（UNIX 秒） */
  date: number;
  /** 1 株あたりの配当額（分割調整されていない生の値） */
  amount: number;
};

/** 株式分割 1 回分 */
export type SplitEvent = {
  /** 分割の実施日（UNIX 秒） */
  date: number;
  /**
   * 分割比率。5:1 の分割なら numerator=5, denominator=1。
   * 1 株が 5 株になるので、それ以前の 1 株あたりの金額は 5 で割る。
   */
  numerator: number;
  denominator: number;
};

export type DividendSummary = {
  /** 1 株あたりの年間配当（直近 12 か月・分割補正済み・税引前） */
  annualDividend: number;
  /** 直近 12 か月の支払回数 */
  count: number;
  /** 最後の支払日 */
  lastDate: Date | null;
  /** 最後の 1 回あたりの配当額 */
  lastAmount: number | null;
  /** 支払頻度の推定 */
  frequency: DividendFrequency;
  /**
   * 特別配当が含まれているか。
   * true の場合、年間配当は一時的に多くなっているため
   * 来期も同額が続くとは限らない。
   */
  hasSpecialDividend: boolean;
  /**
   * 特別配当を除いた年間配当の推定。
   * 突出した 1 回を平常時の水準に置き換えて計算する。
   * 特別配当がなければ annualDividend と同じ値。
   */
  recurringDividend: number;
  /**
   * 月別の 1 株あたり配当額（配列の添字 0 = 1 月 … 11 = 12 月）。
   *
   * 直近 12 か月の実績を「その支払があった月」に振り分けたもの。
   * 権利落ち日を基準にしている（実際の入金は 2〜3 か月後になることが多いが、
   * 入金日は Yahoo からは取得できないため、権利落ち月を配当月として扱う）。
   */
  monthlyDividends: number[];
};

export type DividendFrequency = "monthly" | "quarterly" | "semiannual" | "annual" | "irregular" | "none";

/**
 * ある配当がその後の分割によって何倍に希薄化したかを求める。
 *
 * 配当日と分割日が同じ場合も分割の影響を受けるものとして扱う。
 * 権利確定は分割前の株数に対して行われるため、分割後の 1 株に換算すると
 * 額は比率で割られる（日本製鉄の 2025-09-29 がこのケース）。
 */
export function splitFactorAfter(dividendDate: number, splits: SplitEvent[]): number {
  let factor = 1;
  for (const s of splits) {
    if (s.date < dividendDate) continue;
    if (s.denominator === 0 || !Number.isFinite(s.numerator) || !Number.isFinite(s.denominator)) continue;
    const ratio = s.numerator / s.denominator;
    if (ratio <= 0) continue;
    factor *= ratio;
  }
  return factor;
}

/** 分割を補正した 1 株あたりの配当額 */
export function adjustDividend(event: DividendEvent, splits: SplitEvent[]): number {
  const factor = splitFactorAfter(event.date, splits);
  return event.amount / factor;
}

/**
 * 支払回数から頻度を推定する。
 * 実績ベースなので、増配のタイミングによっては回数が揺れることがある。
 */
export function estimateFrequency(count: number): DividendFrequency {
  if (count <= 0) return "none";
  if (count >= 10) return "monthly";
  if (count >= 3) return "quarterly";
  if (count === 2) return "semiannual";
  return "annual";
}

/**
 * 配当履歴から年間配当を集計する。
 *
 * 分割補正は行わない（Yahoo の配当額は既に分割調整済み）。
 * 代わりに特別配当を検出してフラグを立てる。
 *
 * @param dividends 配当の支払履歴
 * @param splits 株式分割の履歴（現状は使用しないが、将来の互換のため受け取る）
 * @param now 集計の基準時刻（テストのため注入可能に）
 */
export function summarizeDividends(
  dividends: DividendEvent[],
  splits: SplitEvent[],
  now: Date = new Date()
): DividendSummary {
  const cutoff = now.getTime() / 1000 - 365 * 24 * 3600;
  const recent = dividends
    .filter(d => d.date >= cutoff && Number.isFinite(d.amount) && d.amount > 0)
    .sort((a, b) => a.date - b.date);

  if (recent.length === 0) {
    return {
      annualDividend: 0,
      count: 0,
      lastDate: null,
      lastAmount: null,
      frequency: "none",
      hasSpecialDividend: false,
      recurringDividend: 0,
      monthlyDividends: emptyMonths(),
    };
  }

  const amounts = recent.map(d => d.amount);
  const annualDividend = amounts.reduce((s, v) => s + v, 0);
  const lastIndex = recent.length - 1;
  const special = detectSpecialDividend(amounts);

  /*
   * 月別に振り分ける。同じ月に 2 回入ることもあるため加算していく。
   * 月の判定は現地時間ではなく UTC で行う。権利落ち日は日付単位の情報で
   * 時刻を持たないため、時差でひと月ずれるのを避けたい。
   */
  const monthlyDividends = emptyMonths();
  for (const d of recent) {
    const month = new Date(d.date * 1000).getUTCMonth();
    monthlyDividends[month] += d.amount;
  }

  return {
    annualDividend,
    count: recent.length,
    lastDate: new Date(recent[lastIndex].date * 1000),
    lastAmount: amounts[lastIndex],
    frequency: estimateFrequency(recent.length),
    hasSpecialDividend: special.detected,
    recurringDividend: special.recurring,
    monthlyDividends,
  };
}

/** 12 か月分の 0 埋め配列 */
export function emptyMonths(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

/**
 * 月別の配当額（基軸通貨）を保有全体で合算する。
 *
 * 各保有の「1 株あたりの月別配当 × 株数 × 為替レート」を足し込む。
 * 通貨が混ざるため、必ず基軸通貨に換算してから合算する。
 */
export function aggregateMonthlyIncome(
  positions: Array<{
    /** 1 株あたりの月別配当（現地通貨）。null の銘柄は無視する */
    monthlyDividends: number[] | null;
    quantity: number;
    /** 現地通貨 → 基軸通貨の換算レート */
    fxRate: number;
  }>
): number[] {
  const totals = emptyMonths();
  for (const p of positions) {
    if (!p.monthlyDividends || p.monthlyDividends.length !== 12) continue;
    if (!Number.isFinite(p.quantity) || p.quantity <= 0) continue;
    if (!Number.isFinite(p.fxRate) || p.fxRate <= 0) continue;
    for (let m = 0; m < 12; m++) {
      const v = p.monthlyDividends[m];
      if (!Number.isFinite(v) || v <= 0) continue;
      totals[m] += v * p.quantity * p.fxRate;
    }
  }
  return totals;
}

/** 月別配当のうち最も多い月（0=1月）。全て 0 なら null */
export function peakDividendMonth(monthly: number[]): number | null {
  let best: number | null = null;
  for (let m = 0; m < monthly.length; m++) {
    if (monthly[m] <= 0) continue;
    if (best === null || monthly[m] > monthly[best]) best = m;
  }
  return best;
}

/**
 * 配当が特定の月に偏っているかを表す指標（0〜1）。
 *
 * 上位 3 か月が年間配当の何割を占めるかで測る。
 * 毎月均等なら 3/12 = 0.25、年 2 回に集中していれば 1.0 に近づく。
 * 生活費に充てる場合、偏りが大きいと月々の受取が不安定になる。
 */
export function dividendConcentration(monthly: number[]): number | null {
  const total = monthly.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const top3 = [...monthly].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
  return top3 / total;
}

/** 月のラベル（1 月 〜 12 月） */
export const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);

/**
 * 特別配当（1 回だけ突出して多い配当）を検出する。
 *
 * 判定方法: 最大値が「それ以外の平均」の 2 倍を超えていれば特別配当とみなす。
 * 2 倍という基準は、通常の増配（10〜30% 程度）や中間・期末の差
 * （期末が中間の 1.5 倍程度になることは珍しくない）を誤検出しない水準として選んだ。
 *
 * 支払が 1 回だけの場合は比較対象がないので検出しない。
 *
 * @returns detected 特別配当の有無 / recurring 特別配当を除いた年間配当の推定
 */
export function detectSpecialDividend(amounts: number[]): {
  detected: boolean;
  recurring: number;
} {
  const total = amounts.reduce((s, v) => s + v, 0);
  if (amounts.length < 3) {
    // 2 回以下では「突出」を判断できない（半期配当は期末が多いのが普通）
    return { detected: false, recurring: total };
  }

  const maxIndex = amounts.reduce((best, v, i) => (v > amounts[best] ? i : best), 0);
  const others = amounts.filter((_, i) => i !== maxIndex);
  const othersAvg = others.reduce((s, v) => s + v, 0) / others.length;
  if (othersAvg <= 0) return { detected: false, recurring: total };

  if (amounts[maxIndex] <= othersAvg * 2) {
    return { detected: false, recurring: total };
  }

  /*
   * 突出した 1 回を平常時の水準に置き換えて年間配当を推定する。
   * これにより「特別配当がなければいくらだったか」が分かる。
   */
  const recurring = others.reduce((s, v) => s + v, 0) + othersAvg;
  return { detected: true, recurring };
}

/**
 * 配当利回りが実勢としてありえない水準かを判定する。
 *
 * 特別配当の検出は「支払 3 回以上」を条件にしているため、
 * 年 2 回配当の銘柄で特別配当が出た場合は検出できない
 * （例: 日本製鉄は直近 1 年で 2 回のみ、うち 1 回に特別配当を含み利回り 10.65%）。
 *
 * そこで最終的な安全網として、利回りそのものが高すぎる場合に注意を促す。
 * 8% という基準は、実在する高配当銘柄（REIT や資源株で 6% 台まである）を
 * 誤って警告しない水準として選んだ。
 */
export const IMPLAUSIBLE_YIELD_PCT = 8;

export function isImplausibleYield(yieldPct: number | null): boolean {
  return yieldPct !== null && yieldPct > IMPLAUSIBLE_YIELD_PCT;
}

/**
 * 配当利回りを求める（%）。
 * 現在値が無い・0 以下の場合は null を返す（0% と区別する）。
 */
export function dividendYield(annualDividend: number, price: number | null): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(annualDividend) || annualDividend < 0) return null;
  return (annualDividend / price) * 100;
}

/**
 * 取得原価に対する配当利回り（YOC: Yield on Cost）。
 * 長期保有では「買った値段に対していくら返ってくるか」が実感に近い。
 */
export function yieldOnCost(annualDividend: number, avgCost: number | null): number | null {
  if (avgCost === null || !Number.isFinite(avgCost) || avgCost <= 0) return null;
  if (!Number.isFinite(annualDividend) || annualDividend < 0) return null;
  return (annualDividend / avgCost) * 100;
}

/** 保有 1 件分の年間受取配当（現地通貨） */
export function annualIncome(annualDividend: number | null, quantity: number): number | null {
  if (annualDividend === null || !Number.isFinite(annualDividend)) return null;
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  return annualDividend * quantity;
}

/** 頻度の日本語ラベル */
export const FREQUENCY_LABELS: Record<DividendFrequency, string> = {
  monthly: "毎月",
  quarterly: "四半期",
  semiannual: "年 2 回",
  annual: "年 1 回",
  irregular: "不定期",
  none: "無配",
};
