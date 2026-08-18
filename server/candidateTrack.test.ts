/**
 * 候補提案の 2 系統（関心を広げる／穴を埋める）のテスト。
 *
 * AI の出力をそのまま信じると、EXPAND と書きながら起点が空だったり、
 * 関心の一覧にない産業を起点に書いたりする。そうなると画面で
 * 「関心を広げる提案」の下に根拠のない銘柄が並ぶため、コード側で整える。
 */
import { describe, expect, it } from "vitest";
import {
  buildSuggesterPrompt,
  normalizeTrack,
  type InterestLine,
  type SuggestedCandidate,
  type SuggesterContext,
} from "../server/services/candidateSuggester";

const INTERESTS: InterestLine[] = [
  {
    industry: "Semiconductors",
    sector: "Technology",
    heldCount: 7,
    watchCount: 4,
    weightPct: 12.3,
    symbols: ["NVDA", "AMD", "AVGO", "MRVL", "TSM", "QCOM"],
  },
  {
    industry: "Conglomerates",
    sector: "Industrials",
    heldCount: 7,
    watchCount: 0,
    weightPct: 14.1,
    symbols: ["8058.T", "8001.T", "8002.T"],
  },
];

function candidate(over: Partial<SuggestedCandidate>): SuggestedCandidate {
  return {
    name: "Test",
    symbol: "TEST",
    market: "US",
    track: "EXPAND",
    basedOn: "Semiconductors",
    gapKind: "SECTOR",
    reason: "理由",
    concern: "懸念",
    priority: "MEDIUM",
    targetPrice: 100,
    targetBasis: "根拠",
    ...over,
  };
}

describe("normalizeTrack", () => {
  it("関心の一覧にある産業を起点にした EXPAND はそのまま通す", () => {
    const r = normalizeTrack(candidate({ basedOn: "Semiconductors" }), INTERESTS);
    expect(r.track).toBe("EXPAND");
    expect(r.basedOn).toBe("Semiconductors");
  });

  it("起点が空の EXPAND は FILL に落とす", () => {
    /*
     * 「どの関心から来たか」が言えないなら、関心を広げる提案として
     * 出す根拠がない。穴を埋める提案として扱う方が正確。
     */
    const r = normalizeTrack(candidate({ basedOn: null }), INTERESTS);
    expect(r.track).toBe("FILL");
    expect(r.basedOn).toBeNull();
  });

  it("空白だけの起点も FILL に落とす", () => {
    const r = normalizeTrack(candidate({ basedOn: "   " }), INTERESTS);
    expect(r.track).toBe("FILL");
  });

  it("関心の一覧にない産業を起点にした場合は FILL に落とす", () => {
    /*
     * AI が勝手に「Aerospace & Defense に関心がある」と決めて
     * 提案してくることがある。実際の保有に現れていない産業を
     * 起点として認めると、関心を広げる提案の意味がなくなる。
     */
    const r = normalizeTrack(candidate({ basedOn: "Aerospace & Defense" }), INTERESTS);
    expect(r.track).toBe("FILL");
    expect(r.basedOn).toBeNull();
  });

  it("大文字小文字の違いは同じ産業として扱う", () => {
    /*
     * AI が "semiconductors" と小文字で返すことがある。
     * 厳密一致だと正しい起点まで落としてしまう。
     */
    const r = normalizeTrack(candidate({ basedOn: "semiconductors" }), INTERESTS);
    expect(r.track).toBe("EXPAND");
    // 表示は一覧側の表記に揃える
    expect(r.basedOn).toBe("Semiconductors");
  });

  it("FILL に起点が入っていても落とす", () => {
    /*
     * 穴を埋める提案に「Semiconductors を起点に」と書かれていても
     * 意味が通らない。画面で誤解を生むので消す。
     */
    const r = normalizeTrack(
      candidate({ track: "FILL", basedOn: "Semiconductors" }),
      INTERESTS
    );
    expect(r.track).toBe("FILL");
    expect(r.basedOn).toBeNull();
  });
});

describe("buildSuggesterPrompt", () => {
  const CTX: SuggesterContext = {
    totalValueBase: 860000000,
    borrowedBase: 227000000,
    leverage: 1.36,
    dividendYieldPct: 2.33,
    borrowRatePct: 1.73,
    sectors: [{ label: "情報技術", pct: 30.2, count: 20 }],
    markets: [{ label: "日本株", pct: 52.3, count: 56 }],
    topHoldings: [{ name: "三菱商事", symbol: "8058.T", pct: 4.2, sector: "Industrials" }],
    heldSymbols: ["NVDA", "8058.T"],
    watchedSymbols: ["TSM", "CDNS"],
    interests: INTERESTS,
    watchDetails: [
      {
        symbol: "CDNS",
        name: "Cadence Design Systems",
        industry: "Software - Application",
        reason: "半導体設計ツールの寡占。AI チップ設計需要の恩恵を受ける",
      },
    ],
    sectorGaps: [
      { sector: "Healthcare", heldCount: 0, weightPct: 0 },
      { sector: "Utilities", heldCount: 1, weightPct: 1.2 },
    ],
    previouslySuggested: ["ASML"],
  };

  it("関心のある産業を保有数と検討中の数まで含めて渡す", () => {
    const p = buildSuggesterPrompt(CTX);
    expect(p).toContain("Semiconductors");
    expect(p).toContain("保有 7 銘柄");
    expect(p).toContain("検討中 4 銘柄");
  });

  it("検討中の銘柄は注目理由まで渡す", () => {
    /*
     * 産業名だけでは「なぜ見ているか」が分からず、
     * AI が同じ産業の別銘柄を機械的に挙げるだけになる。
     */
    const p = buildSuggesterPrompt(CTX);
    expect(p).toContain("Cadence Design Systems");
    expect(p).toContain("半導体設計ツールの寡占");
  });

  it("持っていない業種と薄い業種を区別して渡す", () => {
    const p = buildSuggesterPrompt(CTX);
    expect(p).toContain("Healthcare: 保有なし");
    expect(p).toContain("Utilities: 1 銘柄・1.2% のみ");
  });

  it("過去に提案した銘柄を渡す", () => {
    const p = buildSuggesterPrompt(CTX);
    expect(p).toContain("過去に提案した銘柄");
    expect(p).toContain("ASML");
  });

  it("検討中がない場合も「なし」と明示する", () => {
    /*
     * 空欄にすると AI が項目自体を無視し、
     * 関心の起点を勝手に決めてしまう。
     */
    const p = buildSuggesterPrompt({ ...CTX, watchDetails: [], previouslySuggested: [] });
    expect(p).toContain("## 検討中の銘柄");
    expect(p).toMatch(/検討中の銘柄[^#]*なし/);
  });

  it("薄い業種がない場合はそう書く", () => {
    const p = buildSuggesterPrompt({ ...CTX, sectorGaps: [] });
    expect(p).toContain("薄い業種はありません");
  });
});
