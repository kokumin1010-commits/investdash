/**
 * 証券会社アプリごとのスクリーンショットのレイアウト定義。
 *
 * 実際の画面で検証したものだけを登録する。ここに定義があるプラットフォームは
 * OCR プロンプトに具体的な列構成を渡せるため、読み取り精度が上がる。
 * 未知のアプリは `generic` として汎用ルールで処理する。
 */

export type BrokerFormatId = "moomoo_jp" | "rakuten_ispeed" | "futu" | "generic";

export type BrokerFormat = {
  id: BrokerFormatId;
  /** 画面表示用の名称 */
  label: string;
  /** 想定される基準通貨 */
  currency: string | null;
  /** 想定される市場 */
  market: "JP" | "US" | "HK" | "TW" | "MIXED" | null;
  /** 画面からこのフォーマットを見分けるための特徴 */
  signatures: string[];
  /** LLM に渡すレイアウト説明。null の場合は汎用ルールのみを使う */
  layoutPrompt: string | null;
};

/** moomoo 日本版（実データで検証済み） */
const MOOMOO_JP: BrokerFormat = {
  id: "moomoo_jp",
  label: "moomoo 日本版",
  currency: "JPY",
  market: "JP",
  signatures: ["口座", "純資産", "銘柄名/コード", "評価額/数量", "評価損益", "現在値/取得単価"],
  layoutPrompt: `このスクリーンショットは moomoo 日本版アプリの「口座」画面である。レイアウトは次の通り。

画面上部:
- 「純資産 · JPY」の直下に大きく表示される数値が純資産の総額
- その下に「預り金」「出金余力」「現金買付余力」が横に 3 つ並ぶ。cash には「預り金」の値を使う
- 右上の「前日比」は前日からの変動であり、保有ポジションのデータではない

保有一覧の列見出しと各行の対応:
| 列 | 見出し | 上段 | 下段 |
|---|---|---|---|
| 1 | 銘柄名/コード | 銘柄名 | 証券コード＋口座区分タグ（一般/NISA/特定） |
| 2 | 評価額/数量 | 評価額 | 保有数量 |
| 3 | 評価損益 | 評価損益の金額 | 評価損益率（%） |
| 4 | 現在値/取得単価 | 現在値 | 取得単価 |

注意点:
- 4 列目は画面幅の制約で右端が切れやすい。取得単価が「3,390.0(」のように途切れている場合は
  逆算する（取得単価 =（評価額 − 評価損益）÷ 数量）
- 損益が緑色で表示されマイナス記号が付く場合は含み損である。必ず負の数にする
- 最下部の「お気に入り / マーケット / 口座 / 掲示板 / 投資ナビ / 検索」はナビゲーションであり無視する
- 上部の「フィッシング詐欺にご注意ください」という警告バナーも無視する
- 「前日比」の欄は口座全体の前日変動であり、個別銘柄のデータではない
- 含み損が緑色で表示される点に注意する（色ではなく符号で判断する）`,
};

/** 楽天証券 iSPEED（未検証。実際の画面を確認したら layoutPrompt を追加する） */
const RAKUTEN_ISPEED: BrokerFormat = {
  id: "rakuten_ispeed",
  label: "楽天証券 iSPEED",
  currency: "JPY",
  market: "JP",
  signatures: ["iSPEED", "保有商品", "国内株式"],
  layoutPrompt: null,
};

/** 富途牛牛 / Futu（未検証） */
const FUTU: BrokerFormat = {
  id: "futu",
  label: "富途牛牛 / Futu",
  currency: null,
  market: "MIXED",
  signatures: ["富途", "持仓", "總市值", "总市值"],
  layoutPrompt: null,
};

const GENERIC: BrokerFormat = {
  id: "generic",
  label: "その他",
  currency: null,
  market: null,
  signatures: [],
  layoutPrompt: null,
};

export const BROKER_FORMATS: BrokerFormat[] = [MOOMOO_JP, RAKUTEN_ISPEED, FUTU, GENERIC];

/** 選択肢として使えるフォーマット一覧（画面表示用） */
export const BROKER_FORMAT_OPTIONS = BROKER_FORMATS.map(f => ({
  id: f.id,
  label: f.label,
  verified: f.layoutPrompt !== null,
}));

export function getBrokerFormat(id: BrokerFormatId | null | undefined): BrokerFormat {
  if (!id) return GENERIC;
  return BROKER_FORMATS.find(f => f.id === id) ?? GENERIC;
}

/**
 * OCR が返した broker 名から、既知のフォーマットを推定する。
 * 取込のたびに手動選択させずに済ませるための補助。
 */
export function guessFormatFromBrokerName(brokerName: string | null): BrokerFormatId {
  if (!brokerName) return "generic";
  const normalized = brokerName.toLowerCase();

  if (normalized.includes("moomoo")) return "moomoo_jp";
  if (normalized.includes("ispeed") || normalized.includes("楽天")) return "rakuten_ispeed";
  if (normalized.includes("futu") || normalized.includes("富途")) return "futu";

  return "generic";
}
