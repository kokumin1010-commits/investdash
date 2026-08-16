import { describe, expect, it } from "vitest";
import {
  buildDividendCalendar,
  type CalendarInput,
  type DividendCalendarMonth,
} from "./services/dividendCalendar";

/**
 * 配当ページの絞り込みが正しく効くかを検証する。
 *
 * 画面側は「カレンダーの各月から条件に合う entry だけを残し、合計を再計算する」
 * 処理をしている。全体の合計をそのまま出すと、絞り込んだのに全体の金額が
 * 表示されて誤解を生むため、絞り込み後に必ず再計算する必要がある。
 * ここではその処理を同じ形で再現して検証する。
 */

/** 画面と同じ絞り込みロジック */
function filterCalendar(
  calendar: DividendCalendarMonth[],
  opts: { broker?: string; market?: string; query?: string }
) {
  const q = (opts.query ?? "").trim().toLowerCase();
  return calendar.map(m => {
    const entries = m.entries.filter(e => {
      if (opts.broker && e.broker !== opts.broker) return false;
      if (opts.market && e.market !== opts.market) return false;
      if (q) {
        const hit =
          e.name.toLowerCase().includes(q) ||
          e.tickerCode.toLowerCase().includes(q) ||
          e.symbol.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
    return {
      month: m.month,
      entries,
      totalBase: entries.reduce((a, e) => a + e.amountBase, 0),
    };
  });
}

/** 1 株あたりの月別配当と株数・為替から入力を作る */
function makeInput(args: {
  id: number;
  symbol: string;
  tickerCode: string;
  name: string;
  market: CalendarInput["market"];
  broker: CalendarInput["broker"];
  currency?: string;
  quantity: number;
  perShare: number[];
  /** 円換算レート。円建てなら 1 */
  fx?: number;
}): CalendarInput {
  const fx = args.fx ?? 1;
  const monthlyIncomeBase = args.perShare.map(v => v * args.quantity * fx);
  return {
    id: args.id,
    symbol: args.symbol,
    tickerCode: args.tickerCode,
    name: args.name,
    market: args.market,
    broker: args.broker,
    currency: args.currency ?? "JPY",
    quantity: args.quantity,
    dividend: {
      monthlyPerShare: args.perShare,
      monthlyIncomeBase,
      annualIncomeBase: monthlyIncomeBase.reduce((a, v) => a + v, 0),
      hasSpecial: false,
      yieldNeedsCheck: false,
    },
  };
}

describe("配当ページの絞り込み", () => {
  /*
    実データの構成を小さく再現する。
    - 同じ日本株を IBKR と渣打で持つ（口座別に分ける必要がある）
    - SGD 建ての銘柄を混ぜる（円換算が絡む）
  */
  const inputs: CalendarInput[] = [
    makeInput({
      id: 1,
      symbol: "7203.T",
      tickerCode: "7203",
      name: "トヨタ自動車",
      market: "JP",
      broker: "ibkr",
      quantity: 100,
      perShare: [0, 0, 50, 0, 0, 0, 0, 0, 50, 0, 0, 0],
    }),
    makeInput({
      id: 2,
      symbol: "7270.T",
      tickerCode: "7270",
      name: "SUBARU",
      market: "JP",
      broker: "sc_sg",
      quantity: 100,
      perShare: [0, 0, 30, 0, 0, 0, 0, 0, 30, 0, 0, 0],
    }),
    makeInput({
      id: 3,
      symbol: "D05.SI",
      tickerCode: "D05",
      name: "DBS Group Holdings",
      market: "SG",
      broker: "ibkr",
      currency: "SGD",
      quantity: 100,
      perShare: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
      fx: 124,
    }),
  ];
  const calendar = buildDividendCalendar(inputs);

  /** 期待値: 7203 = 10,000 / 7270 = 6,000 / D05 = 24,800 */
  const TOYOTA = 10_000;
  const SUBARU = 6_000;
  const DBS = 24_800;

  it("12 か月分を必ず返し、配当が無い月も残す", () => {
    expect(calendar).toHaveLength(12);
    // 1 月は配当が無い（「無い」ことも情報なので月を落とさない）
    expect(calendar[0].entries).toHaveLength(0);
    expect(calendar[0].totalBase).toBe(0);
  });

  it("絞り込みなしなら全件の合計になる", () => {
    const total = filterCalendar(calendar, {}).reduce((a, m) => a + m.totalBase, 0);
    expect(total).toBeCloseTo(TOYOTA + SUBARU + DBS, 2);
  });

  it("口座で絞ると他の口座の配当は含まれない", () => {
    const ibkr = filterCalendar(calendar, { broker: "ibkr" });
    expect(ibkr.reduce((a, m) => a + m.totalBase, 0)).toBeCloseTo(TOYOTA + DBS, 2);
    const names = new Set(ibkr.flatMap(m => m.entries.map(e => e.name)));
    expect(names.has("SUBARU")).toBe(false);
  });

  it("口座と市場を同時に絞れる", () => {
    const ibkrJp = filterCalendar(calendar, { broker: "ibkr", market: "JP" });
    expect(ibkrJp.reduce((a, m) => a + m.totalBase, 0)).toBeCloseTo(TOYOTA, 2);
    // 3 月（index 2）と 9 月（index 8）にだけ入る
    expect(ibkrJp.filter(m => m.entries.length > 0).map(m => m.month)).toEqual([2, 8]);
  });

  it("市場だけで絞ると口座をまたいで集まる", () => {
    const jp = filterCalendar(calendar, { market: "JP" });
    expect(jp.reduce((a, m) => a + m.totalBase, 0)).toBeCloseTo(TOYOTA + SUBARU, 2);
  });

  it("銘柄名・コードで検索できる", () => {
    expect(
      filterCalendar(calendar, { query: "トヨタ" }).reduce((a, m) => a + m.totalBase, 0)
    ).toBeCloseTo(TOYOTA, 2);
    // ティッカーは大文字小文字を問わず一致する
    expect(
      filterCalendar(calendar, { query: "d05" }).reduce((a, m) => a + m.totalBase, 0)
    ).toBeCloseTo(DBS, 2);
    expect(
      filterCalendar(calendar, { query: "存在しない銘柄" }).every(m => m.entries.length === 0)
    ).toBe(true);
  });

  it("絞り込み後も各月の合計は entry の足し合わせと一致する", () => {
    for (const opts of [
      {},
      { broker: "ibkr" },
      { market: "SG" },
      { broker: "sc_sg", market: "JP" },
    ]) {
      for (const m of filterCalendar(calendar, opts)) {
        expect(m.totalBase).toBeCloseTo(
          m.entries.reduce((a, e) => a + e.amountBase, 0),
          6
        );
      }
    }
  });

  it("同じ月に複数口座がある場合は金額の大きい順に並ぶ", () => {
    // 3 月はトヨタ（5,000）と SUBARU（3,000）が入る
    const march = calendar[2];
    expect(march.entries.map(e => e.name)).toEqual(["トヨタ自動車", "SUBARU"]);
    expect(march.totalBase).toBeCloseTo(8_000, 2);
  });
});
