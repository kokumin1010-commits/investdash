import { describe, expect, it } from "vitest";
import {
  detectUrgentEvents,
  isEarningsNews,
  EARNINGS_IMPACT_THRESHOLD,
  URGENT_IMPACT_THRESHOLD,
  type NewsLike,
} from "../shared/eventDetect";

const news = (o: Partial<NewsLike> & { id: number; symbol: string; title: string }): NewsLike => ({
  summary: null,
  impactScore: 90,
  sentiment: "NEGATIVE",
  publishedAt: new Date("2026-08-17T00:00:00Z"),
  ...o,
});

describe("決算ニュースの判定", () => {
  it("日本語の決算関連を拾う", () => {
    expect(isEarningsNews("トヨタが通期業績予想を上方修正", null)).toBe(true);
    expect(isEarningsNews("第2四半期決算を発表", null)).toBe(true);
    expect(isEarningsNews("増配と自社株買いを決定", null)).toBe(true);
  });

  it("英語・中文の決算関連を拾う", () => {
    expect(isEarningsNews("Apple reports Q3 earnings", null)).toBe(true);
    expect(isEarningsNews("Company issues profit warning", null)).toBe(true);
    expect(isEarningsNews("滙豐公布中期業績", null)).toBe(true);
  });

  it("要約側にキーワードがあっても拾う", () => {
    // 見出しが抽象的で本文に決算が書かれている場合がある
    expect(isEarningsNews("株価が急落", "四半期の営業利益が市場予想を下回った")).toBe(true);
  });

  it("決算と無関係なものは拾わない", () => {
    expect(isEarningsNews("新製品を発表", null)).toBe(false);
    expect(isEarningsNews("CEO が交代", "後任は社内から昇格")).toBe(false);
  });
});

describe("臨時レポートの対象選定", () => {
  const held = new Set(["7203.T", "AAPL"]);

  it("保有していない銘柄は対象外", () => {
    /*
     * 持っていない銘柄で臨時レポートを出しても判断する必要がない。
     * ウォッチリストは別途扱う。
     */
    const events = detectUrgentEvents(
      [news({ id: 1, symbol: "TSLA", title: "決算で大幅な下方修正", impactScore: 95 })],
      held
    );
    expect(events).toHaveLength(0);
  });

  it("決算は影響度がやや低くても取り上げる", () => {
    const events = detectUrgentEvents(
      [news({ id: 1, symbol: "7203.T", title: "通期業績予想を下方修正", impactScore: 72 })],
      held
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("EARNINGS");
  });

  it("決算以外は基準が高い（臨時を出しすぎない）", () => {
    // 週次より高い基準にする。頻繁に届くと見なくなる
    expect(URGENT_IMPACT_THRESHOLD).toBeGreaterThan(EARNINGS_IMPACT_THRESHOLD);

    const below = detectUrgentEvents(
      [news({ id: 1, symbol: "AAPL", title: "新製品を発表", impactScore: 80 })],
      held
    );
    expect(below).toHaveLength(0);

    const above = detectUrgentEvents(
      [news({ id: 2, symbol: "AAPL", title: "新製品を発表", impactScore: 90 })],
      held
    );
    expect(above).toHaveLength(1);
    expect(above[0].kind).toBe("NEWS");
  });

  it("同じ銘柄で複数該当したら 1 件に絞る", () => {
    /*
     * 1 つの決算で「速報」「詳報」「解説」と 3 本出ることがある。
     * そのまま出すと 3 通届いて読まれなくなる。
     */
    const events = detectUrgentEvents(
      [
        news({ id: 1, symbol: "7203.T", title: "【速報】決算を発表", impactScore: 75 }),
        news({ id: 2, symbol: "7203.T", title: "決算の詳報 営業利益は増加", impactScore: 88 }),
        news({ id: 3, symbol: "7203.T", title: "決算の解説", impactScore: 71 }),
      ],
      held
    );

    expect(events).toHaveLength(1);
    // 影響度が最も高いものが残る
    expect(events[0].news.id).toBe(2);
  });

  it("決算と通常ニュースが並んだら決算を優先する", () => {
    // 決算の方が「想定が崩れたか」の判断に直結する
    const events = detectUrgentEvents(
      [
        news({ id: 1, symbol: "AAPL", title: "工場で火災", impactScore: 92 }),
        news({ id: 2, symbol: "AAPL", title: "四半期決算を発表", impactScore: 75 }),
      ],
      held
    );

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("EARNINGS");
  });

  it("影響度の高い順に並ぶ", () => {
    const events = detectUrgentEvents(
      [
        news({ id: 1, symbol: "7203.T", title: "決算を発表", impactScore: 75 }),
        news({ id: 2, symbol: "AAPL", title: "決算を発表", impactScore: 95 }),
      ],
      held
    );

    expect(events.map(e => e.news.symbol)).toEqual(["AAPL", "7203.T"]);
  });

  it("影響度が未取得のものは対象外（0 として扱う）", () => {
    // 未分析のニュースを重大扱いすると誤った臨時レポートが出る
    const events = detectUrgentEvents(
      [news({ id: 1, symbol: "AAPL", title: "決算を発表", impactScore: null })],
      held
    );
    expect(events).toHaveLength(0);
  });
});

