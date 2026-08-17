/**
 * 業種別の配当内訳を作る。
 *
 * 月別の偏りは既に見えているが、業種の偏りは見えていない。
 * 配当の何割が金融から来ているかが分かれば、金利が下がる局面で
 * 収入がどれだけ削られるかを事前に把握できる。
 * 逆に「配当の 4 割が 1 業種に依存している」と分かれば、
 * 次に買う銘柄を別の業種から選ぶ判断もできる。
 */

/** 集計に必要な最小限の形。画面側・DB 側の型に依存させない */
export type SectorDividendInput = {
  /** 銘柄コード。同一銘柄を複数口座で持つ場合は同じ値になる */
  symbol: string;
  /** 業種（Yahoo Finance の sector）。ETF などは持たないので null */
  sector: string | null;
  /** 年間の受取配当（基準通貨）。無配・未取得なら null */
  annualIncomeBase: number | null;
  /** 評価額（基準通貨）。業種ごとの利回りを出すために使う */
  marketValueBase: number | null;
};

export type SectorDividendRow = {
  /** 業種名。業種が取れない銘柄は "未分類" にまとめる */
  sector: string;
  /** この業種の年間配当合計（基準通貨） */
  annualIncomeBase: number;
  /** 年間配当全体に対する割合（%） */
  sharePct: number;
  /** この業種の評価額合計（基準通貨） */
  marketValueBase: number;
  /**
   * この業種の配当利回り（%）。評価額が 0 なら null。
   * 「どの業種が効率よく配当を生んでいるか」が分かる。
   */
  yieldPct: number | null;
  /** この業種で配当を受け取っている銘柄数（銘柄単位で重複を除く） */
  symbolCount: number;
};

export type SectorDividendBreakdown = {
  rows: SectorDividendRow[];
  /** 年間配当の合計（基準通貨） */
  totalIncomeBase: number;
  /**
   * 最も配当額が大きい業種の占有率（%）。
   * 1 業種への依存度を一目で見るために使う。
   */
  topSharePct: number | null;
  /** 最も配当額が大きい業種名 */
  topSector: string | null;
};

import { UNCLASSIFIED_SECTOR } from "../../shared/sectorLabels";

// 画面側でも同じ値を使うため shared から再輸出する
export { UNCLASSIFIED_SECTOR };

/**
 * 業種別に配当を集計する。
 *
 * 金額は口座レコード単位で足す（同じ銘柄を複数口座で持てば株数の合計に比例するため）。
 * 銘柄数は銘柄単位で数える（口座ごとに数えると同じ会社が二重に出る）。
 */
export function buildSectorDividends(
  items: SectorDividendInput[],
): SectorDividendBreakdown {
  type Acc = {
    income: number;
    marketValue: number;
    symbols: Set<string>;
  };
  const bySector = new Map<string, Acc>();

  for (const item of items) {
    const income = item.annualIncomeBase ?? 0;
    /*
     * 配当が無い銘柄は業種の行に含めない。
     * 無配銘柄の評価額を分母に入れると、その業種の配当利回りが
     * 実際に配当を出している銘柄の水準より低く出てしまう。
     */
    if (income <= 0) continue;

    const sector = item.sector?.trim() ? item.sector.trim() : UNCLASSIFIED_SECTOR;
    const acc = bySector.get(sector) ?? { income: 0, marketValue: 0, symbols: new Set() };
    acc.income += income;
    acc.marketValue += item.marketValueBase ?? 0;
    acc.symbols.add(item.symbol);
    bySector.set(sector, acc);
  }

  let totalIncomeBase = 0;
  bySector.forEach(acc => {
    totalIncomeBase += acc.income;
  });

  const rows: SectorDividendRow[] = [];
  bySector.forEach((acc, sector) => {
    rows.push({
      sector,
      annualIncomeBase: acc.income,
      sharePct: totalIncomeBase > 0 ? (acc.income / totalIncomeBase) * 100 : 0,
      marketValueBase: acc.marketValue,
      yieldPct: acc.marketValue > 0 ? (acc.income / acc.marketValue) * 100 : null,
      symbolCount: acc.symbols.size,
    });
  });

  // 配当額の大きい順。金額の大きい業種から確認したいため
  rows.sort((a, b) => b.annualIncomeBase - a.annualIncomeBase);

  /*
   * 「未分類」は業種の話ではないので、金額が大きくても
   * 依存度の判定（topSector）からは除く。ETF が最大でも
   * 「ETF に依存している」という指摘は業種の偏りを表さない。
   */
  const classified = rows.filter(r => r.sector !== UNCLASSIFIED_SECTOR);
  const top = classified[0] ?? null;

  return {
    rows,
    totalIncomeBase,
    topSharePct: top ? top.sharePct : null,
    topSector: top ? top.sector : null,
  };
}

// 業種名の日本語表記は shared/sectorLabels.ts に置いた（画面側と共用するため）
export { sectorLabelJa } from "../../shared/sectorLabels";
