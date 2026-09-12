export type LongTermChartSpan = "10Y" | "20Y" | "MAX";

export type MonthlyLongTermPricePoint = {
  t: number;
  price: number;
};

export type AnnualPriceBar = {
  year: number;
  t: number;
  close: number;
  yearHigh: number;
  yearLow: number;
  returnPct: number | null;
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function aggregateAnnualPrices(
  points: MonthlyLongTermPricePoint[],
  span: LongTermChartSpan
): AnnualPriceBar[] {
  const valid = points
    .filter(
      point =>
        Number.isFinite(point.t) &&
        point.t > 0 &&
        Number.isFinite(point.price) &&
        point.price > 0
    )
    .sort((a, b) => a.t - b.t);
  if (valid.length === 0) return [];

  const latestYear = new Date(valid[valid.length - 1].t).getUTCFullYear();
  const minimumYear =
    span === "MAX" ? Number.NEGATIVE_INFINITY : latestYear - (span === "10Y" ? 9 : 19);
  const grouped = new Map<number, MonthlyLongTermPricePoint[]>();
  for (const point of valid) {
    const year = new Date(point.t).getUTCFullYear();
    if (year < minimumYear) continue;
    const bucket = grouped.get(year) ?? [];
    bucket.push(point);
    grouped.set(year, bucket);
  }

  const bars = Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, bucket]) => {
      const close = bucket[bucket.length - 1].price;
      return {
        year,
        t: bucket[bucket.length - 1].t,
        close: round(close),
        yearHigh: round(Math.max(...bucket.map(point => point.price))),
        yearLow: round(Math.min(...bucket.map(point => point.price))),
        returnPct: null,
      } satisfies AnnualPriceBar;
    });

  return bars.map((bar, index) => {
    const previous = bars[index - 1];
    return {
      ...bar,
      returnPct:
        previous?.close && previous.close > 0
          ? round(((bar.close - previous.close) / previous.close) * 100, 2)
          : null,
    };
  });
}

export function summarizeAnnualPrices(bars: AnnualPriceBar[]) {
  if (bars.length === 0) {
    return {
      latestClose: null,
      peakClose: null,
      drawdownFromPeakPct: null,
      startYear: null,
      endYear: null,
    };
  }
  const latestClose = bars[bars.length - 1].close;
  const peakClose = Math.max(...bars.map(bar => bar.close));
  return {
    latestClose,
    peakClose,
    drawdownFromPeakPct:
      peakClose > 0 ? round(((latestClose - peakClose) / peakClose) * 100, 2) : null,
    startYear: bars[0].year,
    endYear: bars[bars.length - 1].year,
  };
}
