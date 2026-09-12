import * as db from "../db";
import {
  selectUnheldResearchIdeas,
  UNHELD_RESEARCH_POOL_LIMIT,
  UNHELD_RESEARCH_POOL_TARGET,
  UNHELD_RESEARCH_POOL_VERSION,
  type UnheldResearchIdeaInput,
} from "../../shared/unheldResearchIdeas";
import { buildPortfolio } from "./portfolio";

export async function listUnheldResearchIdeas(userId: number) {
  const [candidateRows, portfolio, watchItems] = await Promise.all([
    db.listCandidateSuggestions(userId, 60),
    buildPortfolio(userId),
    db.listWatchlist(userId),
  ]);
  const candidates: UnheldResearchIdeaInput[] = candidateRows.map(row => ({
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    track: row.track,
    basedOn: row.basedOn,
    gapKind: row.gapKind,
    reason: row.reason,
    concern: row.concern,
    priority: row.priority,
    priceAtSuggestion:
      row.priceAtSuggestion == null ? null : Number(row.priceAtSuggestion),
    targetPrice: row.targetPrice == null ? null : Number(row.targetPrice),
    targetBasis: row.targetBasis,
    currency: row.currency,
    sector: row.sector,
    industry: row.industry,
    addedToWatchlist: row.addedToWatchlist,
    dismissed: row.dismissed,
    createdAt: row.createdAt,
  }));
  const ideas = selectUnheldResearchIdeas(
    candidates,
    portfolio.groups.map(group => group.symbol),
    watchItems.map(item => item.symbol),
    UNHELD_RESEARCH_POOL_LIMIT
  );

  return {
    version: UNHELD_RESEARCH_POOL_VERSION,
    targetCount: UNHELD_RESEARCH_POOL_TARGET,
    maxCount: UNHELD_RESEARCH_POOL_LIMIT,
    count: ideas.length,
    remainingToTarget: Math.max(0, UNHELD_RESEARCH_POOL_TARGET - ideas.length),
    canGenerateMore: ideas.length < UNHELD_RESEARCH_POOL_TARGET,
    ideas,
  };
}
