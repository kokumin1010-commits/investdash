import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";
import { getBrokerFormat, type BrokerFormatId } from "./brokerFormats";

/**
 * 証券会社アプリのスクリーンショットから、保有ポジションと実際の
 * キャッシュ収入根拠を同時に抽出する。
 *
 * AI の出力は必ず確認前の草稿として扱い、ここでは DB に書き込まない。
 */

export type ParsedPosition = {
  name: string;
  tickerCode: string;
  /** 画面上の取引所コード。表示がなければ null */
  exchange?: string | null;
  /** K 表記を含む画面上の数量文字列。表示がなければ null */
  quantityDisplay?: string | null;
  /** K / M など丸め表示なら true */
  quantityIsRounded?: boolean;
  quantity: number | null;
  avgCost: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  confidence: number;
};

export type ParsedInterestAsset = {
  /** 画面から読めた証券会社名。判定不能なら null */
  broker: string | null;
  name: string;
  currency: string | null;
  /** 現在残高／評価額（原通貨） */
  amount: number | null;
  /** 画面表示の年率（%） */
  annualRatePct: number | null;
  /** 画面表示の最新1日分利息（原通貨） */
  dailyIncome: number | null;
  /** 購入開始からの累計収益（原通貨） */
  cumulativeIncome: number | null;
  /** 画面に明記された基準日。YYYY-MM-DD。読めなければ null */
  asOfDate: string | null;
  confidence: number;
  /** どの表示ラベルを根拠にしたか。短い説明のみ */
  evidence: string | null;
};

export type ParsedDividendIncome = {
  broker: string | null;
  symbol: string | null;
  name: string;
  currency: string | null;
  /** 税前額。画面に表示がなければ null */
  grossAmount: number | null;
  /** 源泉税。画面に表示がなければ null */
  taxAmount: number | null;
  /** 手数料。画面に表示がなければ null */
  feeAmount: number | null;
  /** 実際の入金額。画面に表示がなければ null */
  netAmount: number | null;
  /** 実際の入金日／受渡日。YYYY-MM-DD。読めなければ null */
  occurredOn: string | null;
  confidence: number;
  evidence: string | null;
};

export type ParsedAccount = {
  netAssets: number | null;
  cash: number | null;
  currency: string | null;
  broker: string | null;
  cashAsOfDate: string | null;
  confidence: number;
  evidence: string | null;
};

export type OcrResult = {
  positions: ParsedPosition[];
  interestAssets: ParsedInterestAsset[];
  dividendIncomes: ParsedDividendIncome[];
  account: ParsedAccount;
  warnings: string[];
  formatId: BrokerFormatId;
  model: string;
};

export const SCREENSHOT_EXTRACTION_MODEL = "gemini-3.1-pro-preview";

const SYSTEM_PROMPT = `あなたは証券口座のスクリーンショットを読み取る専門のデータ抽出エンジンです。

絶対ルール:
1. 画面に実際に表示されている文字と数値だけを抽出する。推測、補完、将来予想は行わない。
2. 数値や日付が途切れている、隠れている、ラベルとの対応が不明な場合は null にし、warnings に理由を書く。
3. 桁区切りのカンマは除去して数値化する。マイナス記号を落とさない。
4. 日付は画面に明記された場合だけ YYYY-MM-DD に正規化する。年が表示されていない日付は null にする。
5. 通貨は画面に明記された ISO コード（JPY/USD/SGD/HKD 等）を使う。判別できなければ null にする。
6. confidence は各行の全必須項目の読み取り確度を 0-100 で表す。95以上は文字・数値・ラベルが明瞭、60-94は一部注意、59以下は要確認。
7. evidence には「累計収益」「配当金入金」のように、実際に見えたラベルと行を短く記録する。画像にない説明を作らない。

保有ポジション positions:
- 銘柄名、コード、数量、取得単価、現在値、評価額、評価損益を読み取る。
- exchange には銘柄コード横の取引所表示（NYSE / NASDAQ.NMS / TSEJ / SGX 等）をそのまま入れる。表示がなければ null。
- quantityDisplay には画面上の数量文字列（例: 400 / 1.10K / 88.4K）をそのまま入れ、K / M 等の丸め表示なら quantityIsRounded を true にする。
- 評価損益率が表示されている場合は、%記号を除いた符号付き数値を pnlPct に入れる。
- 取得単価が右端で見切れている場合、評価額・数量・評価損益がすべて明瞭なときだけ
  取得単価 =（評価額 − 評価損益）÷ 数量 で逆算し、warnings に記録する。
- 行が画面下端で途切れている場合は含めない。
- 「一般」「NISA」「特定」などの口座タグを名称やコードに含めない。

利息資産 interestAssets:
- 「現金宝」「貨幣基金」「貨幣市場基金」など、日次で利息が付く現金性商品の画面だけを対象にする。
- amount は現在残高／評価額、annualRatePct は表示年率、dailyIncome は「前日収益／昨日収益／日次利息」、
  cumulativeIncome は「累計収益／持有收益」の明示値を対応させる。
- 株式、ETF、債券、株式型投資信託を現金性資産として扱わない。
- 年率から日次利息や累計収益を逆算しない。日次利息から累計収益も逆算しない。

実際の配当入金 dividendIncomes:
- 「配当金」「分配金」「Dividend」が実際に入金／受渡／決済済みになった明細だけを対象にする。
- 予想配当、配当利回り、権利予定、未決済、入金予定は絶対に含めない。
- occurredOn は画面の入金日／受渡日、netAmount は実際の入金額。
- 税引前額、源泉税、手数料がそれぞれ表示されている場合だけ対応欄へ入れる。
- 画面に netAmount だけがある場合、grossAmount/taxAmount/feeAmount は null のままにする。
- 税前額から税や手数料を推測せず、税率を仮定しない。

account:
- 画面上部の純資産、預り金／現金、通貨、証券会社名を読み取る。
- 買付力や最大購買力を現金や資産として扱わない。
- cashAsOfDate は現金残高の基準日が画面に明記された場合だけ設定する。年が無ければ null。
- confidence は cash、currency、broker とラベルの対応確度。evidence は「預り金」「現金残高」のような画面上の根拠。`;

const nullableNumber = { type: ["number", "null"] } as const;
const nullableString = { type: ["string", "null"] } as const;

const OUTPUT_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "portfolio_and_cash_income_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              tickerCode: { type: "string" },
              exchange: nullableString,
              quantityDisplay: nullableString,
              quantityIsRounded: { type: "boolean" },
              quantity: nullableNumber,
              avgCost: nullableNumber,
              currentPrice: nullableNumber,
              marketValue: nullableNumber,
              pnl: nullableNumber,
              pnlPct: nullableNumber,
              confidence: { type: "number" },
            },
            required: [
              "name",
              "tickerCode",
              "exchange",
              "quantityDisplay",
              "quantityIsRounded",
              "quantity",
              "avgCost",
              "currentPrice",
              "marketValue",
              "pnl",
              "pnlPct",
              "confidence",
            ],
            additionalProperties: false,
          },
        },
        interestAssets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              broker: nullableString,
              name: { type: "string" },
              currency: nullableString,
              amount: nullableNumber,
              annualRatePct: nullableNumber,
              dailyIncome: nullableNumber,
              cumulativeIncome: nullableNumber,
              asOfDate: nullableString,
              confidence: { type: "number" },
              evidence: nullableString,
            },
            required: [
              "broker",
              "name",
              "currency",
              "amount",
              "annualRatePct",
              "dailyIncome",
              "cumulativeIncome",
              "asOfDate",
              "confidence",
              "evidence",
            ],
            additionalProperties: false,
          },
        },
        dividendIncomes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              broker: nullableString,
              symbol: nullableString,
              name: { type: "string" },
              currency: nullableString,
              grossAmount: nullableNumber,
              taxAmount: nullableNumber,
              feeAmount: nullableNumber,
              netAmount: nullableNumber,
              occurredOn: nullableString,
              confidence: { type: "number" },
              evidence: nullableString,
            },
            required: [
              "broker",
              "symbol",
              "name",
              "currency",
              "grossAmount",
              "taxAmount",
              "feeAmount",
              "netAmount",
              "occurredOn",
              "confidence",
              "evidence",
            ],
            additionalProperties: false,
          },
        },
        account: {
          type: "object",
          properties: {
            netAssets: nullableNumber,
            cash: nullableNumber,
            currency: nullableString,
            broker: nullableString,
            cashAsOfDate: nullableString,
            confidence: { type: "number" },
            evidence: nullableString,
          },
          required: [
            "netAssets",
            "cash",
            "currency",
            "broker",
            "cashAsOfDate",
            "confidence",
            "evidence",
          ],
          additionalProperties: false,
        },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: [
        "positions",
        "interestAssets",
        "dividendIncomes",
        "account",
        "warnings",
      ],
      additionalProperties: false,
    },
  },
};

export async function extractPositions(
  imageDataUrls: string[],
  formatId?: BrokerFormatId
): Promise<OcrResult> {
  if (imageDataUrls.length === 0) {
    return {
      positions: [],
      interestAssets: [],
      dividendIncomes: [],
      account: emptyAccount(),
      warnings: ["画像が指定されていません"],
      formatId: formatId ?? "generic",
      model: SCREENSHOT_EXTRACTION_MODEL,
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
          ? `${imageDataUrls.length} 枚のスクリーンショットです。同一証券口座の同じ月の画面として扱ってください。重複する保有行、現金性商品、配当明細は1件にまとめ、保有・現金性資産・実際の配当入金をすべて抽出してください。`
          : "このスクリーンショットから、保有ポジション、現金性資産、実際の配当入金を抽出してください。",
    },
    ...imageDataUrls.map(url => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  const res = await invokeLLM({
    model: SCREENSHOT_EXTRACTION_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    responseFormat: OUTPUT_SCHEMA,
    maxTokens: 16384,
  });

  const text = res.choices?.[0]?.message?.content;
  const parsed = parseLlmJson<Partial<OcrResult>>(text, "読み取り結果");
  const normalizedPositions = (parsed.positions ?? [])
    .filter(position => position.name && position.tickerCode)
    .map(position => normalizePosition(position, format.id));
  const positions = sanitizePositionsForFormat(normalizedPositions, format.id);
  const warnings = [...(parsed.warnings ?? [])];
  if (positions.length < normalizedPositions.length) {
    warnings.push(
      `保有数量と取得単価が揃わない市況表示 ${normalizedPositions.length - positions.length} 件を保有候補から除外しました`
    );
  }

  return {
    positions,
    interestAssets: (parsed.interestAssets ?? [])
      .filter(asset => asset.name)
      .map(normalizeInterestAsset),
    dividendIncomes: (parsed.dividendIncomes ?? [])
      .filter(income => income.name)
      .map(normalizeDividendIncome),
    account: normalizeAccount(parsed.account),
    warnings,
    formatId: format.id,
    model: SCREENSHOT_EXTRACTION_MODEL,
  };
}

function sanitizePositionsForFormat(
  positions: ParsedPosition[],
  formatId?: BrokerFormatId
): ParsedPosition[] {
  if (formatId !== "rakuten_ispeed") return positions;
  return positions.filter(
    position =>
      position.quantity !== null &&
      position.quantity > 0 &&
      position.avgCost !== null &&
      position.avgCost > 0
  );
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo(value: number | null | undefined, digits: number): number | null {
  const parsed = finite(value);
  if (parsed === null) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

function nonNegative(value: number | null | undefined, digits: number) {
  const parsed = roundTo(value, digits);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function confidence(value: number | null | undefined) {
  const parsed = finite(value);
  return parsed === null ? 0 : Math.max(0, Math.min(100, Math.round(parsed)));
}

function currency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{3,8}$/.test(normalized) ? normalized : null;
}

function date(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function normalizePosition(
  position: ParsedPosition,
  formatId?: BrokerFormatId
): ParsedPosition {
  const priceDigits = formatId === "sc_sg" || formatId === "futu_hk" ? 4 : 2;
  const quantityDigits = formatId === "futu_hk" ? 4 : 0;
  return {
    ...position,
    exchange: position.exchange?.trim().toUpperCase() || null,
    quantityDisplay: position.quantityDisplay?.trim() || null,
    quantityIsRounded: Boolean(position.quantityIsRounded),
    quantity: roundTo(position.quantity, quantityDigits),
    avgCost: roundTo(position.avgCost, priceDigits),
    currentPrice: roundTo(position.currentPrice, priceDigits),
    marketValue: roundTo(position.marketValue, 2),
    pnl: roundTo(position.pnl, 2),
    pnlPct: roundTo(position.pnlPct, 4),
    confidence: confidence(position.confidence),
  };
}

function normalizeInterestAsset(asset: ParsedInterestAsset): ParsedInterestAsset {
  return {
    broker: asset.broker?.trim() || null,
    name: asset.name.trim(),
    currency: currency(asset.currency),
    amount: nonNegative(asset.amount, 4),
    annualRatePct: nonNegative(asset.annualRatePct, 4),
    dailyIncome: roundTo(asset.dailyIncome, 4),
    cumulativeIncome: roundTo(asset.cumulativeIncome, 4),
    asOfDate: date(asset.asOfDate),
    confidence: confidence(asset.confidence),
    evidence: asset.evidence?.trim() || null,
  };
}

function normalizeDividendIncome(income: ParsedDividendIncome): ParsedDividendIncome {
  return {
    broker: income.broker?.trim() || null,
    symbol: income.symbol?.trim() || null,
    name: income.name.trim(),
    currency: currency(income.currency),
    grossAmount: nonNegative(income.grossAmount, 4),
    taxAmount: nonNegative(income.taxAmount, 4),
    feeAmount: nonNegative(income.feeAmount, 4),
    netAmount: nonNegative(income.netAmount, 4),
    occurredOn: date(income.occurredOn),
    confidence: confidence(income.confidence),
    evidence: income.evidence?.trim() || null,
  };
}

function normalizeAccount(
  account: Partial<ParsedAccount> | null | undefined
): ParsedAccount {
  return {
    netAssets: roundTo(account?.netAssets, 4),
    cash: roundTo(account?.cash, 4),
    currency: currency(account?.currency),
    broker: account?.broker?.trim() || null,
    cashAsOfDate: date(account?.cashAsOfDate),
    confidence: confidence(account?.confidence),
    evidence: account?.evidence?.trim() || null,
  };
}

/** テスト用エクスポート */
export const normalizePositionForTest = normalizePosition;
export const sanitizePositionsForFormatForTest = sanitizePositionsForFormat;
export const normalizeInterestAssetForTest = normalizeInterestAsset;
export const normalizeDividendIncomeForTest = normalizeDividendIncome;

function emptyAccount(): ParsedAccount {
  return {
    netAssets: null,
    cash: null,
    currency: null,
    broker: null,
    cashAsOfDate: null,
    confidence: 0,
    evidence: null,
  };
}
