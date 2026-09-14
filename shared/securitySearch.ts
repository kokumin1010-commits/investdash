export type SecuritySearchMarket = "JP" | "US" | "SG" | "HK" | "TW" | "KR" | "OTHER";

const MARKET_LABELS: Record<SecuritySearchMarket, string> = {
  JP: "日本株",
  US: "米国株",
  SG: "シンガポール株",
  HK: "香港株",
  TW: "台湾株",
  KR: "韓国株",
  OTHER: "その他",
};

export function inferSecuritySearchMarket(
  symbol: string,
  exchange?: string | null
): SecuritySearchMarket {
  const normalized = symbol.trim().toUpperCase();
  const normalizedExchange = exchange?.trim().toUpperCase() ?? "";
  if (normalized.endsWith(".SI") || ["SES", "SGX"].includes(normalizedExchange)) return "SG";
  if (normalized.endsWith(".T") || ["JPX", "TSE", "TSEJ"].includes(normalizedExchange)) return "JP";
  if (normalized.endsWith(".HK") || ["HKG", "HKEX", "SEHK"].includes(normalizedExchange)) return "HK";
  if (normalized.endsWith(".TW") || normalized.endsWith(".TWO") || normalizedExchange === "TAI") return "TW";
  if (normalized.endsWith(".KS") || normalized.endsWith(".KQ") || ["KSC", "KOE"].includes(normalizedExchange)) return "KR";
  if (["NYQ", "NMS", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS"].includes(normalizedExchange)) return "US";
  if (!normalized.includes(".")) return "US";
  return "OTHER";
}

export function securitySearchMarketLabel(market: SecuritySearchMarket): string {
  return MARKET_LABELS[market];
}

export function displayTickerForSearch(symbol: string): string {
  return symbol.trim().toUpperCase().split(".")[0] ?? symbol;
}

/**
 * コードだけを入力したときに、相場の存在確認に使う候補。
 * 推測した値を保存せず、実在する相場だけを採用する前提で使う。
 */
export function buildDirectSecurityCandidates(raw: string): string[] {
  const input = raw.trim().toUpperCase();
  if (!input) return [];
  if (input.includes(".")) return [input];

  if (/^[0-9]{6}$/.test(input)) {
    return [`${input}.KS`, `${input}.KQ`];
  }

  if (/^[0-9]{5}$/.test(input)) {
    const hk = String(Number(input)).padStart(4, "0");
    return [`${hk}.HK`];
  }

  if (/^[0-9]{4}$/.test(input) || /^[0-9]{3}[0-9A-Z]$/.test(input)) {
    const hk = /^[0-9]{4}$/.test(input) ? `${input}.HK` : null;
    return [
      `${input}.T`,
      `${input}.TW`,
      `${input}.TWO`,
      ...(hk ? [hk] : []),
    ];
  }

  return [input, `${input}.SI`];
}
