import { invokeLLM } from "../_core/llm";

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
};

const SYSTEM_PROMPT = `あなたは証券口座のスクリーンショットを読み取る専門のデータ抽出エンジンです。

読み取りルール:
1. 画面に実際に表示されている数値のみを抽出する。推測や補完は絶対に行わない。
2. 数値が途切れている・見切れている場合は null にし、warnings に理由を記載する。
3. 桁区切りのカンマは除去して数値化する（例: "4,859,250.00" → 4859250）。
4. 楽天証券 iSPEED の保有一覧では、各行のレイアウトは次の通り:
   - 1列目: 銘柄名（上段）と証券コード（下段、"一般"や"NISA"などのタグが付く）
   - 2列目: 評価額（上段）と数量（下段）
   - 3列目: 評価損益（上段は金額、下段はパーセント）
   - 4列目: 現在値（上段）と取得単価（下段）
5. 取得単価が右端で見切れている場合（例: "3,390.0(" のように末尾が欠けている）、
   評価額・数量・評価損益から逆算できる場合のみ算出し、warnings に「取得単価を逆算」と記載する。
   逆算式: 取得単価 =（評価額 − 評価損益）÷ 数量
6. マイナスの損益は必ず負の数として表現する。
7. 証券コードは日本株なら4桁の数字（末尾が英字の場合もある）、米国株ならアルファベットのティッカー。
8. 画面上部の「純資産」「預り金」も抽出する。
9. 行が画面下端で途切れて数値が読めない場合はその行を含めず、warnings に記載する。

confidence は各行の読み取り確度を 0-100 で自己評価する。全ての数値が明瞭なら 95 以上、
一部を逆算・推定した場合は 60-80、不明瞭な箇所が多い場合は 50 未満とする。`;

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
 */
export async function extractPositions(imageDataUrls: string[]): Promise<OcrResult> {
  if (imageDataUrls.length === 0) {
    return { positions: [], account: emptyAccount(), warnings: ["画像が指定されていません"] };
  }

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
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    responseFormat: OUTPUT_SCHEMA,
    maxTokens: 16384,
  });

  const text = res.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("AI が読み取り結果を返しませんでした。もう一度お試しください。");
  }

  let parsed: OcrResult;
  try {
    parsed = JSON.parse(text) as OcrResult;
  } catch {
    throw new Error("読み取り結果の解析に失敗しました。画像を変えてお試しください。");
  }

  return {
    positions: (parsed.positions ?? []).filter(p => p.name && p.tickerCode),
    account: parsed.account ?? emptyAccount(),
    warnings: parsed.warnings ?? [],
  };
}

function emptyAccount(): ParsedAccount {
  return { netAssets: null, cash: null, currency: null, broker: null };
}

