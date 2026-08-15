import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";
import { getBrokerFormat, type BrokerFormatId } from "./brokerFormats";

/**
 * 証券会社アプリのスクリーンショットから保有ポジションを抽出する。
 * マルチモーダル対応モデルに JSON Schema 構造化出力を要求する。
 */

export type ParsedPosition = {
  /** 画面に表示されていた銘柄名（日本語可） */
  name: string;
  /** 証券コード or ティッカー */
  tickerCode: string;
  /** 保有株数 */
  quantity: number | null;
  /** 取得単価 */
  avgCost: number | null;
  /** 現在値（画面表示値。後で API 値で上書きされる） */
  currentPrice: number | null;
  /** 評価額 */
  marketValue: number | null;
  /** 評価損益 */
  pnl: number | null;
  /** 抽出の確信度 0-100 */
  confidence: number;
};

export type ParsedAccount = {
  /** 純資産 */
  netAssets: number | null;
  /** 預り金・現金 */
  cash: number | null;
  /** 通貨 */
  currency: string | null;
  /** 証券会社名の推定 */
  broker: string | null;
};

export type OcrResult = {
  positions: ParsedPosition[];
  account: ParsedAccount;
  /** 読み取りに関する注意点 */
  warnings: string[];
  /** 実際に適用したフォーマット */
  formatId: BrokerFormatId;
};

const SYSTEM_PROMPT = `あなたは証券口座のスクリーンショットを読み取る専門のデータ抽出エンジンです。

読み取りルール:
1. 画面に実際に表示されている数値のみを抽出する。推測や補完は絶対に行わない。
2. 数値が途切れている・見切れている場合は null にし、warnings に理由を記載する。
3. 桁区切りのカンマは除去して数値化する（例: "4,859,250.00" → 4859250）。
4. 各行は上下 2 段の組み合わせで表示される。列見出しの「A/B」という表記は
   「上段が A、下段が B」を意味する。見出しを必ず確認してから列を対応づける。
5. 取得単価が右端で見切れている場合（例: "3,390.0(" のように末尾が欠けている）、
   評価額・数量・評価損益から逆算できる場合のみ算出し、warnings に「取得単価を逆算」と記載する。
   逆算式: 取得単価 =（評価額 − 評価損益）÷ 数量
6. マイナスの損益は必ず負の数として表現する。
7. 証券コードは日本株なら 4 桁の数字（末尾が英字の場合もある）、米国株ならアルファベットの
   ティッカー、香港株なら 5 桁以内の数字、台湾株なら 4 桁の数字。
8. 画面上部の「純資産」「預り金」も抽出する。
9. 行が画面下端で途切れて数値が読めない場合はその行を含めず、warnings に記載する。
10. 銘柄名が「オリエンタル…」のように省略記号で切れている場合は、表示されている文字を
    そのまま name に入れる。勝手に補完してはならない。証券コードから正式名称を特定するのは
    後段の処理が行う。
11. 「一般」「NISA」「特定」などの口座区分タグは銘柄名やコードに含めない。

confidence は各行の読み取り確度を 0-100 で自己評価する。全ての数値が明瞭なら 95 以上、
一部を逆算・推定した場合は 60-80、不明瞭な箇所が多い場合は 50 未満とする。

broker には画面から判断できるアプリ名を入れる。判断できない場合は null にする。`;

const OUTPUT_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "portfolio_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "画面表示の銘柄名" },
              tickerCode: { type: "string", description: "証券コードまたはティッカー" },
              quantity: { type: ["number", "null"] },
              avgCost: { type: ["number", "null"] },
              currentPrice: { type: ["number", "null"] },
              marketValue: { type: ["number", "null"] },
              pnl: { type: ["number", "null"] },
              confidence: { type: "number" },
            },
            required: [
              "name",
              "tickerCode",
              "quantity",
              "avgCost",
              "currentPrice",
              "marketValue",
              "pnl",
              "confidence",
            ],
            additionalProperties: false,
          },
        },
        account: {
          type: "object",
          properties: {
            netAssets: { type: ["number", "null"] },
            cash: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            broker: { type: ["string", "null"] },
          },
          required: ["netAssets", "cash", "currency", "broker"],
          additionalProperties: false,
        },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["positions", "account", "warnings"],
      additionalProperties: false,
    },
  },
};

/**
 * base64 データ URL（複数枚可）を渡してポジションを抽出する。
 *
 * `formatId` を指定すると、そのアプリのレイアウト定義をプロンプトに含めるため
 * 列の対応を誤りにくくなる。省略時は汎用ルールで読み取る。
 */
export async function extractPositions(
  imageDataUrls: string[],
  formatId?: BrokerFormatId
): Promise<OcrResult> {
  if (imageDataUrls.length === 0) {
    return {
      positions: [],
      account: emptyAccount(),
      warnings: ["画像が指定されていません"],
      formatId: formatId ?? "generic",
    };
  }

  const format = getBrokerFormat(formatId);
  const systemPrompt = format.layoutPrompt
    ? `${SYSTEM_PROMPT}\n\n---\n\n${format.layoutPrompt}`
    : SYSTEM_PROMPT;

  const content = [
    {
      type: "text" as const,
      text:
        imageDataUrls.length > 1
          ? `${imageDataUrls.length} 枚のスクリーンショットです。同一口座の連続した画面として扱い、重複行は 1 件にまとめてください。`
          : "このスクリーンショットから保有ポジションを抽出してください。",
    },
    ...imageDataUrls.map(url => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  const res = await invokeLLM({
    model: "gemini-3.1-pro-preview",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    responseFormat: OUTPUT_SCHEMA,
    maxTokens: 16384,
  });

  const text = res.choices?.[0]?.message?.content;
  // Markdown で返るモデルもあるため、コードフェンス/前置き文があっても JSON を取り出す
  const parsed = parseLlmJson<OcrResult>(text, "読み取り結果");

  return {
    positions: (parsed.positions ?? []).filter(p => p.name && p.tickerCode).map(normalizePosition),
    account: parsed.account ?? emptyAccount(),
    warnings: parsed.warnings ?? [],
    formatId: format.id,
  };
}

/**
 * 逆算した取得単価が `3389.315789473684` のような長い小数になることがあるため、
 * 価格系は小数第 2 位、数量は整数に丸める。
 */
function normalizePosition(p: ParsedPosition): ParsedPosition {
  return {
    ...p,
    quantity: roundTo(p.quantity, 0),
    avgCost: roundTo(p.avgCost, 2),
    currentPrice: roundTo(p.currentPrice, 2),
    marketValue: roundTo(p.marketValue, 2),
    pnl: roundTo(p.pnl, 2),
  };
}

function roundTo(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** テスト用エクスポート */
export const normalizePositionForTest = normalizePosition;

function emptyAccount(): ParsedAccount {
  return { netAssets: null, cash: null, currency: null, broker: null };
}
