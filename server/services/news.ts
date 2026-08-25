import { createHash } from "node:crypto";
import type { Market } from "../../shared/investing";

/**
 * Google News RSS から銘柄関連ニュースを取得する。
 * 公開 RSS のためキー不要。日本株は日本語、米国株は英語ロケールを使う。
 */

export type RawNews = {
  title: string;
  url: string;
  urlHash: string;
  source: string | null;
  publishedAt: Date | null;
};

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]) : null;
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 40);
}

/**
 * Google News RSS を検索してニュース一覧を返す。
 */
export async function searchNews(
  query: string,
  opts: { market?: Market; windowDays?: number; limit?: number } = {}
): Promise<RawNews[]> {
  const { market = "JP", windowDays = 30, limit = 12 } = opts;
  /*
   * 検索ロケール。日本株は日本語、それ以外は英語で探す。
   * シンガポール株は現地報道が英語なので US ロケールで足りる。
   */
  const locale =
    market === "JP"
      ? { hl: "ja", gl: "JP", ceid: "JP:ja" }
      : { hl: "en-US", gl: "US", ceid: "US:en" };

  const q = encodeURIComponent(`${query} when:${windowDays}d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InvestDash/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[news] RSS request failed: ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const out: RawNews[] = [];

    for (const block of items.slice(0, limit)) {
      const title = pick(block, "title");
      const link = pick(block, "link");
      if (!title || !link) continue;
      const pub = pick(block, "pubDate");
      const parsed = pub ? new Date(pub) : null;
      out.push({
        title: title.slice(0, 500),
        url: link.slice(0, 1000),
        urlHash: hashUrl(link),
        source: pick(block, "source"),
        publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      });
    }
    return out;
  } catch (error) {
    console.warn(`[news] searchNews failed for "${query}":`, error);
    return [];
  }
}

/**
 * 銘柄に対する検索クエリを構築する。
 * 日本株は「銘柄名 + 証券コード」、米国株は「社名 + ティッカー」が有効。
 */
export function buildNewsQuery(params: {
  name: string;
  tickerCode: string;
  market: Market;
}): string {
  const { name, tickerCode, market } = params;
  const cleanName = name.replace(/[（(].*?[）)]/g, "").trim();
  if (market === "JP") {
    return `${cleanName} ${tickerCode}`;
  }
  return `${cleanName} ${tickerCode} stock`;
}

/** ノイズ記事（掲示板・時系列データ等）を除外する */
const NOISE_PATTERNS = [
  /掲示板/,
  /時系列/,
  /現物信用売買内訳/,
  /株価速報/,
  /^マーケット速報$/,
  /信用残/,
  /チャート$/,
];

export function filterNoise(items: RawNews[]): RawNews[] {
  const seen = new Set<string>();
  return items.filter(it => {
    // タイトルまたは URL が欠けている記事は扱わない
    if (!it.title || it.title.trim().length === 0) return false;
    if (!it.url || it.url.trim().length === 0) return false;

    // 定型的な自動生成記事（株価チャート等）を除外する
    if (NOISE_PATTERNS.some(p => p.test(it.title))) return false;

    // 同一 URL の重複を除去する
    const key = it.url.trim();
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}
