/**
 * 保有とウォッチリストから「何に関心があるか」を読み取る。
 *
 * 候補提案の出発点として、これまで使っていたのは「セクターの構成比」だけ
 * だった。しかしセクターは 11 種類しかなく粒度が粗い。Technology 一括りでは
 * 半導体・半導体製造装置・業務ソフトのどれに関心があるのか分からず、
 * AI は「テクノロジーが多いので別のセクターを」としか答えられない。
 *
 * そこで industry（Semiconductors / REIT - Industrial など数十種類）で
 * 集計する。実データでは保有に Semiconductors 7 銘柄・Conglomerates 7 銘柄、
 * ウォッチリストに Semiconductors 4 銘柄があり、「半導体に関心が強い」と
 * 具体的に言える。
 *
 * ウォッチリストを保有より強い関心として扱う。まだ買っていないのに登録して
 * あるということは「これから買う意思がある」という意思表示であり、
 * 昔に買って持ち続けている銘柄より現在の関心を表す。
 */

/** 集計の入力となる 1 銘柄 */
export type InterestInput = {
  symbol: string;
  name: string;
  /** 業種（大分類）。取得できていない場合は null */
  sector: string | null;
  /** 産業（小分類）。関心の粒度としてはこちらが本命 */
  industry: string | null;
  /** 評価額（円換算）。ウォッチリスト銘柄は未保有なので null */
  valueBase: number | null;
  /** ウォッチリスト由来か */
  fromWatchlist: boolean;
};

/** 関心が集まっている産業 */
export type InterestCluster = {
  /** 産業名（Yahoo Finance の industry をそのまま使う） */
  industry: string;
  /** 属する業種 */
  sector: string | null;
  /** 保有している銘柄数 */
  heldCount: number;
  /** ウォッチリストにある銘柄数 */
  watchCount: number;
  /** 保有分の評価額合計（円） */
  heldValueBase: number;
  /** 全体に対する評価額の割合（%）。ウォッチのみの産業は 0 */
  weightPct: number;
  /** 関心の強さ。並べ替えと「どれを起点にするか」の判断に使う */
  interestScore: number;
  /** 代表的な銘柄（表示と AI への提示用） */
  symbols: string[];
};

/**
 * ウォッチリスト 1 銘柄を保有何銘柄分の関心として数えるか。
 *
 * 2 にしているのは、まだ買っていない銘柄をわざわざ登録して目標価格まで
 * 決めているのは、既に持っている銘柄より強い「これから買いたい」意思の
 * 表れだと考えられるため。3 以上にするとウォッチ 1 銘柄だけの産業が
 * 保有 2 銘柄の産業を上回ってしまい、実際の資金配分と乖離する。
 */
const WATCH_WEIGHT = 2;

/**
 * 関心クラスタとして扱う最小の銘柄数。
 *
 * 1 銘柄だけの産業を「関心がある」と扱うと、たまたま 1 つ持っている
 * だけの産業が数十件並び、どこに関心があるのか読めなくなる。
 * ただしウォッチリストにある産業は 1 銘柄でも対象にする（買う意思が
 * 明示されているため）。
 */
const MIN_HELD_FOR_CLUSTER = 2;

export function buildInterestClusters(
  inputs: InterestInput[],
  totalValueBase: number
): InterestCluster[] {
  const map = new Map<
    string,
    {
      sector: string | null;
      held: Set<string>;
      watch: Set<string>;
      heldValue: number;
      symbols: string[];
    }
  >();

  for (const it of inputs) {
    /*
     * industry が取れていない銘柄は集計しない。
     * 「未分類」としてまとめると、それが最大のクラスタになって
     * 提案の起点が「未分類を埋める」になってしまう。
     */
    const industry = it.industry?.trim();
    if (!industry) continue;

    const cur =
      map.get(industry) ??
      {
        sector: it.sector,
        held: new Set<string>(),
        watch: new Set<string>(),
        heldValue: 0,
        symbols: [] as string[],
      };

    const sym = it.symbol.trim().toUpperCase();
    if (it.fromWatchlist) {
      cur.watch.add(sym);
    } else {
      cur.held.add(sym);
      cur.heldValue += it.valueBase ?? 0;
    }
    if (!cur.symbols.includes(sym)) cur.symbols.push(sym);
    if (cur.sector === null && it.sector) cur.sector = it.sector;

    map.set(industry, cur);
  }

  const clusters: InterestCluster[] = [];
  map.forEach((v, industry) => {
    const heldCount = v.held.size;
    const watchCount = v.watch.size;
    if (watchCount === 0 && heldCount < MIN_HELD_FOR_CLUSTER) return;

    clusters.push({
      industry,
      sector: v.sector,
      heldCount,
      watchCount,
      heldValueBase: v.heldValue,
      weightPct: totalValueBase > 0 ? (v.heldValue / totalValueBase) * 100 : 0,
      interestScore: heldCount + watchCount * WATCH_WEIGHT,
      symbols: v.symbols,
    });
  });

  /*
   * 関心の強い順。同点なら評価額の大きい順にする。
   * 銘柄数が同じなら実際に資金を入れている方が関心が強い。
   */
  clusters.sort(
    (a, b) => b.interestScore - a.interestScore || b.heldValueBase - a.heldValueBase
  );
  return clusters;
}

/**
 * 保有していない（＝穴になっている）業種を洗い出す。
 *
 * 構成比が小さい業種を「穴」と呼ぶだけでは、実際には持っていない業種と
 * 少しだけ持っている業種が混ざる。前者は新規に検討する価値があり、
 * 後者は既に判断済みの可能性が高いので分けて扱う。
 */
export type SectorGap = {
  sector: string;
  /** 保有している銘柄数。0 なら完全な穴 */
  heldCount: number;
  weightPct: number;
};

/**
 * 「薄い」と判断する構成比の上限（%）。
 *
 * 5% にしているのは、11 業種に均等配分すれば 1 業種 9% になるため、
 * その半分を下回る業種は明らかに薄いと言えるから。
 */
const THIN_SECTOR_PCT = 5;

export function findSectorGaps(
  allSectors: string[],
  heldSectors: Array<{ sector: string; count: number; pct: number }>
): SectorGap[] {
  const heldMap = new Map(heldSectors.map(s => [s.sector, s]));
  const gaps: SectorGap[] = [];

  for (const sector of allSectors) {
    const held = heldMap.get(sector);
    if (!held) {
      gaps.push({ sector, heldCount: 0, weightPct: 0 });
      continue;
    }
    if (held.pct < THIN_SECTOR_PCT) {
      gaps.push({ sector, heldCount: held.count, weightPct: held.pct });
    }
  }

  // 薄い順（完全な穴が先）
  gaps.sort((a, b) => a.weightPct - b.weightPct);
  return gaps;
}
