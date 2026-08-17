/**
 * 同一銘柄のレコード間で業種を埋め合わせる。
 *
 * 業種（sector）は企業プロファイルの取得時に holdings のレコード単位で
 * 保存される。同じ銘柄を複数の口座で持っている場合、片方のレコードだけが
 * 更新されて他方が未取得のまま残ることがある（実データで 8 件該当）。
 *
 * 業種は銘柄の属性であって口座ごとに変わるものではないので、
 * 同じ銘柄の他レコードに値があればそれを使う。DB は書き換えず表示時に
 * 補うだけなので、次回のプロファイル取得の対象からは外れない
 * （DB を埋めてしまうと「取得済み」と見なされ、業界や事業概要など
 * 他の項目が永久に空のままになる）。
 */

export type SectorSource = {
  symbol: string;
  sector: string | null;
  industry: string | null;
};

export type SectorInfo = {
  sector: string;
  industry: string | null;
};

/**
 * 銘柄ごとに「判明している業種」の対応表を作る。
 *
 * 業種が判明していない銘柄（ETF など）は対応表に含めない。
 * 含めてしまうと呼び出し側で「取得済みだが空」と区別できなくなる。
 */
export function fillMissingSectors(rows: SectorSource[]): Map<string, SectorInfo> {
  const map = new Map<string, SectorInfo>();
  for (const r of rows) {
    // 空文字は未取得と同じ扱いにする（DB に空文字が入るケースがある）
    if (!r.sector) continue;
    if (map.has(r.symbol)) continue;
    map.set(r.symbol, { sector: r.sector, industry: r.industry || null });
  }
  return map;
}

