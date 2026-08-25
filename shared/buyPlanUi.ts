export function formatNextBandHint(gapPct: number, actionLabel: string): string {
  const distance = Math.abs(gapPct);
  if (distance < 0.05) {
    return `現在の水準が「${actionLabel}」の目安`;
  }
  return `${distance.toFixed(1)}% 下がると「${actionLabel}」`;
}

export type BuyPlanListFilter = "BUY" | "WAIT" | "VERIFY" | "OUTSIDE" | "ALL";

export function filterBuyPlanRows<
  T extends {
    action: string | null;
    outsideDirection: string | null;
    symbol: string;
    name: string;
  },
>(plans: T[], filter: BuyPlanListFilter, keyword: string): T[] {
  const query = keyword.trim().toLowerCase();
  return plans.filter(plan => {
    if (
      (filter === "BUY" && plan.action !== "ADD_SMALL" && plan.action !== "ADD_MAIN") ||
      (filter === "WAIT" && plan.action !== "HOLD") ||
      (filter === "VERIFY" && plan.action !== "VERIFY") ||
      (filter === "OUTSIDE" && plan.outsideDirection === null)
    ) {
      return false;
    }
    if (!query) return true;
    return (
      plan.symbol.toLowerCase().includes(query) ||
      plan.name.toLowerCase().includes(query)
    );
  });
}

export function buildProposalConsultHref(input: {
  symbol: string;
  name: string;
  stanceLabel: string;
  conclusion: string;
  invalidation?: string | null;
}): string {
  const question = [
    `${input.name}（${input.symbol}）の買い増し提案について相談したい。`,
    `現在の提案は「${input.stanceLabel}」で、理由は「${input.conclusion}」。`,
    input.invalidation ? `覆す条件は「${input.invalidation}」。` : null,
    "現在の保有比率・借入・価格帯を踏まえて、この判断が妥当か説明してほしい。",
  ]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({ symbol: input.symbol, question });
  return `/consult?${params.toString()}`;
}
