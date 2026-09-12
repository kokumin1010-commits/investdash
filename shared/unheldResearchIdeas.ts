export const UNHELD_RESEARCH_POOL_VERSION = "unheld-research-v1";
export const UNHELD_RESEARCH_POOL_TARGET = 24;
export const UNHELD_RESEARCH_POOL_LIMIT = 30;

export type ResearchIdeaPriority = "HIGH" | "MEDIUM" | "LOW";
export type ResearchIdeaTrack = "EXPAND" | "FILL";

export type UnheldResearchIdeaInput = {
  symbol: string;
  name: string;
  market: string;
  track: ResearchIdeaTrack;
  basedOn: string | null;
  gapKind: string;
  reason: string;
  concern: string;
  priority: ResearchIdeaPriority;
  priceAtSuggestion: number | null;
  targetPrice: number | null;
  targetBasis: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  addedToWatchlist: boolean;
  dismissed: boolean;
  createdAt: Date;
};

export type UnheldResearchIdea = UnheldResearchIdeaInput & {
  sourceLabel: string;
  missingChecks: string[];
  nextAction: string;
};

const priorityOrder: Record<ResearchIdeaPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function sourceLabel(input: UnheldResearchIdeaInput): string {
  if (input.track === "EXPAND") {
    return input.basedOn
      ? `関心を広げる・${input.basedOn}`
      : "関心を広げる候補";
  }
  const gapLabels: Record<string, string> = {
    SECTOR: "薄い業種を補う",
    REGION: "地域分散を補う",
    YIELD: "インカム収入を補う",
    RISK: "組み合わせリスクを補う",
  };
  return gapLabels[input.gapKind] ?? "組合せの穴を補う";
}

export function selectUnheldResearchIdeas(
  candidates: UnheldResearchIdeaInput[],
  heldSymbols: Iterable<string>,
  watchedSymbols: Iterable<string>,
  limit = UNHELD_RESEARCH_POOL_LIMIT
): UnheldResearchIdea[] {
  const held = new Set(Array.from(heldSymbols, normalizeSymbol));
  const watched = new Set(Array.from(watchedSymbols, normalizeSymbol));
  const unique = new Map<string, UnheldResearchIdeaInput>();

  for (const candidate of candidates) {
    const symbol = normalizeSymbol(candidate.symbol);
    if (!symbol || !candidate.name.trim()) continue;
    if (candidate.dismissed || candidate.addedToWatchlist) continue;
    if (held.has(symbol) || watched.has(symbol)) continue;
    const current = unique.get(symbol);
    if (!current || candidate.createdAt > current.createdAt) {
      unique.set(symbol, { ...candidate, symbol });
    }
  }

  return Array.from(unique.values())
    .sort(
      (a, b) =>
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        (a.track === b.track ? 0 : a.track === "EXPAND" ? -1 : 1) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.symbol.localeCompare(b.symbol)
    )
    .slice(0, Math.max(0, limit))
    .map(candidate => ({
      ...candidate,
      sourceLabel: sourceLabel(candidate),
      missingChecks: ["企業資料の再確認", "投資カード作成", "価格帯と初回購入量の決定"],
      nextAction: "ウォッチリストへ追加し、企業資料・価格帯・初回購入量を確認する",
    }));
}
