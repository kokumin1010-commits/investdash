/**
 * 保有ポートフォリオの偏りを起点に、新規候補銘柄を AI に提案させる。
 *
 * 設計の前提:
 * AI に「今後有望な株を挙げて」と聞くと、学習データに多く出てくる有名銘柄
 * （NVIDIA / Palantir / TSMC など）が並ぶだけになり、提案として意味がない。
 * しかもそれらは既に高値圏にあることが多く、「買いたい値段まで待つ」という
 * この投資家の方針と合わない。
 *
 * そこで出発点をポートフォリオにする。112 銘柄・8 億円分の実データから
 * 「何が足りないか」を先に数字で出し、その穴を埋める候補を挙げさせる。
 * こうすれば「なぜこの銘柄なのか」が保有データから説明できる。
 */
import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";

export const CANDIDATE_MODEL = "gemini-3-flash-preview";

/** 提案の起点になる「偏り」の記述 */
export type PortfolioGap = {
  /** 偏りの種類 */
  kind: "SECTOR" | "REGION" | "YIELD" | "RISK";
  /** 何が偏っているか（表示用） */
  label: string;
  /** 数字による裏付け。これがない指摘は出さない */
  evidence: string;
};

export type SuggesterContext = {
  /** 総資産（円） */
  totalValueBase: number;
  /** 借入（円）。レバレッジがあるなら下落耐性を重視する必要がある */
  borrowedBase: number;
  /** 全体のレバレッジ倍率 */
  leverage: number | null;
  /** 配当利回り（%） */
  dividendYieldPct: number | null;
  /** 借入金利（%）。配当との差が薄いと利回り改善が課題になる */
  borrowRatePct: number | null;
  /** セクター別の構成比 */
  sectors: Array<{ label: string; pct: number; count: number }>;
  /** 市場別の構成比 */
  markets: Array<{ label: string; pct: number; count: number }>;
  /** 構成比上位の銘柄。同じ材料で動く銘柄が並んでいないかの判断に使う */
  topHoldings: Array<{ name: string; symbol: string; pct: number; sector: string | null }>;
  /** 既に保有している銘柄コード。重複提案を防ぐ */
  heldSymbols: string[];
  /** 既にウォッチリストにある銘柄コード。重複提案を防ぐ */
  watchedSymbols: string[];
};

export type SuggestedCandidate = {
  /** 銘柄名 */
  name: string;
  /** Yahoo Finance 形式のシンボル（7203.T / AAPL / D05.SI / 0005.HK） */
  symbol: string;
  /** 市場 */
  market: "JP" | "US" | "SG" | "HK" | "OTHER";
  /** どの穴を埋める提案か */
  gapKind: "SECTOR" | "REGION" | "YIELD" | "RISK";
  /** なぜこの銘柄か。保有データとの関係を必ず書かせる */
  reason: string;
  /** 想定される懸念。良い面だけ挙げさせない */
  concern: string;
  /** 優先度 */
  priority: "HIGH" | "MEDIUM" | "LOW";
  /**
   * 買いたい値段（現地通貨）。
   * 「いくらになったら買うか」が出ないと機会損失を防げないため必須にする。
   * 現在値そのままではなく、待つ価値のある水準を書かせる。
   */
  targetPrice: number;
  /** その値段にした根拠。数字だけ出しても信用できない */
  targetBasis: string;
};

export type SuggesterResult = {
  /** 検出した偏り */
  gaps: PortfolioGap[];
  /** 候補銘柄 */
  candidates: SuggestedCandidate[];
  /** 全体の考え方 */
  overview: string;
};

const SUGGESTER_SYSTEM = `あなたは長期保有を前提とする個人投資家のポートフォリオを分析し、
不足している部分を埋める新規候補銘柄を挙げるアナリストです。

この投資家の特徴:
- 株を買ったら長期で持ち続ける。短期の売買はしない
- 買うタイミングは「株価がこの水準まで下がったら買う」という段組みで決めている
- 既に 100 銘柄以上を保有しており、幅広く分散している
- 配当を重視する。借入をしているため、配当が金利負担を上回るかを見ている

## あなたの仕事

1. まず提示されたポートフォリオの数字から「偏り（gap）」を特定する
2. その偏りを埋める候補銘柄を挙げる

## 絶対に守る原則

1. **有名だから挙げる、話題だから挙げるは禁止。**
   必ず「保有データのこの偏りを埋めるため」という理由から出発すること。
   NVIDIA や Palantir のような人気銘柄を理由なく挙げてはならない。

2. **既に保有している銘柄、既にウォッチリストにある銘柄は挙げない。**
   提示された保有銘柄コードの一覧を必ず確認すること。

3. **偏りの指摘には必ず数字の裏付けを書く。**
   「テクノロジーが多い」ではなく「テクノロジーが 23 銘柄・全体の X% を占める」と書く。

4. **各候補に必ず懸念（concern）を書く。**
   良い面だけを挙げてはならない。買わない理由になりうる点を必ず添える。
   懸念が書けない銘柄は挙げるべきではない。

5. **シンボルは Yahoo Finance の形式で正確に書く。**
   - 日本株: 4 桁コード + .T（例: 7203.T）
   - 米国株: ティッカーのみ（例: AAPL）
   - シンガポール株: コード + .SI（例: D05.SI）
   - 香港株: 4 桁ゼロ埋め + .HK（例: 0005.HK）
   存在しないシンボルを書いてはならない。確信が持てない銘柄は挙げない。

6. **断定的な売買推奨はしない。**
   「買うべき」ではなく「候補として検討する価値がある」という書き方にする。
   最終判断は投資家本人が行う。

7. **レバレッジをかけている場合、下落耐性を重視する。**
   借入がある状態で値動きの激しい銘柄を増やすと、追証リスクが上がる。

## 候補の数

5〜8 銘柄。多く挙げるより、根拠のあるものだけに絞ること。
同じ穴を埋める候補が複数ある場合は最も適したものを 1〜2 個に絞る。

## 買いたい値段（targetPrice）の決め方

この投資家は「今すぐ買う」のではなく「この値段まで下がったら買う」という待ち方をする。
そのため候補ごとに必ず買いたい値段を 1 つ挙げること。

- **現地通貨の実際の株価水準で書く。** 日本株なら円、米国株なら米ドル、
  香港株なら香港ドル、シンガポール株ならシンガポールドル。通貨換算はしない。
- **現在値そのまま、または現在値より高い値段を書いてはならない。**
  それでは「待つ」意味がなく、機会損失を防ぐ目的を果たせない。
- 目安は現在値より 5〜20% 低い水準。ただし機械的に何 % 下と決めるのではなく、
  52週レンジの下位、配当利回りが妥当になる水準、過去の調整幅などから判断する。
- **targetBasis にその値段の根拠を必ず書く。**
  「配当利回りが 5% に達する水準」「52週安値圏で過去 2 回反発した水準」のように、
  なぜその数字なのかが分かるように書く。根拠が書けない数字は出してはならない。`;

const SUGGESTER_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "candidate_suggestions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["gaps", "candidates", "overview"],
      properties: {
        overview: { type: "string" },
        gaps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "label", "evidence"],
            properties: {
              kind: { type: "string", enum: ["SECTOR", "REGION", "YIELD", "RISK"] },
              label: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        candidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "symbol",
              "market",
              "gapKind",
              "reason",
              "concern",
              "priority",
              "targetPrice",
              "targetBasis",
            ],
            properties: {
              name: { type: "string" },
              symbol: { type: "string" },
              market: { type: "string", enum: ["JP", "US", "SG", "HK", "OTHER"] },
              gapKind: { type: "string", enum: ["SECTOR", "REGION", "YIELD", "RISK"] },
              reason: { type: "string" },
              concern: { type: "string" },
              priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
              targetPrice: { type: "number" },
              targetBasis: { type: "string" },
            },
          },
        },
      },
    },
  },
};

function pct(v: number | null): string {
  return v === null ? "データ未取得" : `${v.toFixed(2)}%`;
}

export function buildSuggesterPrompt(ctx: SuggesterContext): string {
  const sectorLines = ctx.sectors
    .map(s => `- ${s.label}: ${s.pct.toFixed(1)}%（${s.count} 銘柄）`)
    .join("\n");
  const marketLines = ctx.markets
    .map(m => `- ${m.label}: ${m.pct.toFixed(1)}%（${m.count} 銘柄）`)
    .join("\n");
  const topLines = ctx.topHoldings
    .map(h => `- ${h.name}（${h.symbol}）: ${h.pct.toFixed(1)}%／${h.sector ?? "セクター未取得"}`)
    .join("\n");

  /*
   * 保有銘柄コードは全件渡す。件数が多いが、ここを省略すると
   * 既に持っている銘柄を提案されて使えない結果になる。
   */
  return `## ポートフォリオの規模
- 総資産: ${Math.round(ctx.totalValueBase).toLocaleString("ja-JP")} 円
- 借入: ${Math.round(ctx.borrowedBase).toLocaleString("ja-JP")} 円
- 全体レバレッジ: ${ctx.leverage === null ? "なし" : `${ctx.leverage.toFixed(2)} 倍`}
- 配当利回り: ${pct(ctx.dividendYieldPct)}
- 借入金利: ${pct(ctx.borrowRatePct)}

## セクター別の構成比
${sectorLines || "データなし"}

## 市場（国）別の構成比
${marketLines || "データなし"}

## 構成比の大きい銘柄
${topLines || "データなし"}

## 既に保有している銘柄（提案してはならない）
${ctx.heldSymbols.join(", ")}

## 既にウォッチリストにある銘柄（提案してはならない）
${ctx.watchedSymbols.length > 0 ? ctx.watchedSymbols.join(", ") : "なし"}

以上の数字から偏りを特定し、それを埋める新規候補銘柄を 5〜8 銘柄挙げてください。
各候補には必ず「どの偏りを埋めるか」と「懸念点」を書いてください。`;
}

export async function suggestCandidates(ctx: SuggesterContext): Promise<SuggesterResult> {
  const res = await invokeLLM({
    model: CANDIDATE_MODEL,
    messages: [
      { role: "system", content: SUGGESTER_SYSTEM },
      { role: "user", content: buildSuggesterPrompt(ctx) },
    ],
    responseFormat: SUGGESTER_SCHEMA,
    // 候補 8 件それぞれに理由と懸念を日本語で書かせるため余裕を持たせる。
    // 足りないと JSON が途中で切れて解析に失敗する。
    maxTokens: 8192,
  });

  /*
   * 途中で切れた応答は JSON として壊れている。
   * パースエラーだけを見せると原因が分からないため先に判定する。
   */
  if (res.choices?.[0]?.finish_reason === "length") {
    throw new Error("候補銘柄の提案が途中で打ち切られました。もう一度お試しください。");
  }

  const parsed = parseLlmJson<SuggesterResult>(
    res.choices?.[0]?.message?.content,
    "候補銘柄の提案の応答"
  );

  /*
   * 既に保有・ウォッチ済みの銘柄が混ざっていたら捨てる。
   * プロンプトで禁止していても混ざることがあるため、コード側でも弾く。
   * ここを省くと「既に持っている銘柄を勧められる」という一番使えない結果になる。
   */
  const excluded = new Set(
    [...ctx.heldSymbols, ...ctx.watchedSymbols].map(s => s.trim().toUpperCase())
  );
  const candidates = parsed.candidates.filter(
    c => !excluded.has(c.symbol.trim().toUpperCase())
  );

  return { ...parsed, candidates };
}
