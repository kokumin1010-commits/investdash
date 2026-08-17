/**
 * 業種名の日本語表記。
 *
 * Yahoo Finance は英語で返すため、画面では日本語に置き換える。
 * サーバー側の集計とクライアント側の表示の両方から使うため shared に置く。
 */

/** 業種が取れない銘柄（ETF など）をまとめる先 */
export const UNCLASSIFIED_SECTOR = "未分類";

const SECTOR_JA: Record<string, string> = {
  "Financial Services": "金融",
  "Real Estate": "不動産",
  "Consumer Defensive": "生活必需品",
  "Consumer Cyclical": "一般消費財",
  Technology: "情報技術",
  "Basic Materials": "素材",
  Industrials: "資本財",
  Healthcare: "ヘルスケア",
  Energy: "エネルギー",
  Utilities: "公共事業",
  "Communication Services": "通信サービス",
};

/**
 * 未知の業種はそのまま英語で出す。
 * 勝手に「その他」へ丸めると、新しい業種が来たときに気付けなくなる。
 */
export function sectorLabelJa(sector: string): string {
  if (sector === UNCLASSIFIED_SECTOR) return UNCLASSIFIED_SECTOR;
  return SECTOR_JA[sector] ?? sector;
}

