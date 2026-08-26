import { describe, expect, it } from "vitest";
import { buildNewsQueries, buildNewsQuery, filterNoise, hashUrl, type RawNews } from "./services/news";

function makeNews(partial: Partial<RawNews>): RawNews {
  return {
    title: "サンプルニュース",
    url: "https://example.com/article",
    source: "Example",
    publishedAt: new Date(),
    summary: null,
    ...partial,
  };
}

describe("hashUrl", () => {
  it("同じ URL は同じハッシュを返す", () => {
    expect(hashUrl("https://example.com/a")).toBe(hashUrl("https://example.com/a"));
  });

  it("異なる URL は異なるハッシュを返す", () => {
    expect(hashUrl("https://example.com/a")).not.toBe(hashUrl("https://example.com/b"));
  });

  it("十分な長さのハッシュを返す", () => {
    expect(hashUrl("https://example.com/a").length).toBeGreaterThanOrEqual(16);
  });
});

describe("buildNewsQuery", () => {
  it("ティッカーを先頭に置き、市場別 fallback を返す", () => {
    expect(buildNewsQueries({ name: "中国平安保険", tickerCode: "2318", market: "HK" })).toEqual([
      "2318 中国平安保険 Hong Kong stock",
      "2318 Hong Kong stock",
      "中国平安保険 Hong Kong stock",
    ]);
  });

  it("日本株は銘柄名とコードを含む検索クエリを生成する", () => {
    const q = buildNewsQuery({ name: "SUBARU", tickerCode: "7270", market: "JP" });
    expect(q).toContain("SUBARU");
  });

  it("米国株はティッカーを含む検索クエリを生成する", () => {
    const q = buildNewsQuery({ name: "Microsoft", tickerCode: "MSFT", market: "US" });
    expect(q).toContain("Microsoft");
  });

  it("空でないクエリを返す", () => {
    const q = buildNewsQuery({ name: "キヤノン", tickerCode: "7751", market: "JP" });
    expect(q.trim().length).toBeGreaterThan(0);
  });
});

describe("filterNoise", () => {
  it("重複 URL を除去する", () => {
    const items = [
      makeNews({ url: "https://example.com/same", title: "記事A" }),
      makeNews({ url: "https://example.com/same", title: "記事A（重複）" }),
      makeNews({ url: "https://example.com/other", title: "記事B" }),
    ];
    const result = filterNoise(items);
    const urls = result.map(r => r.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("タイトルが空の記事を除去する", () => {
    const items = [
      makeNews({ title: "", url: "https://example.com/empty" }),
      makeNews({ title: "正常な記事", url: "https://example.com/ok" }),
    ];
    const result = filterNoise(items);
    expect(result.every(r => r.title.trim().length > 0)).toBe(true);
  });

  it("正常な記事は保持する", () => {
    const items = [
      makeNews({ title: "決算発表", url: "https://example.com/1" }),
      makeNews({ title: "新製品発表", url: "https://example.com/2" }),
    ];
    expect(filterNoise(items).length).toBe(2);
  });

  it("空配列を渡しても落ちない", () => {
    expect(filterNoise([])).toEqual([]);
  });
});
