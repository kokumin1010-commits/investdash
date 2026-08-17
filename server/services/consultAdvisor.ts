/**
 * 相談 AI。保有状況を前提に置いて質問に答える。
 *
 * 方針:
 * - 結論をはっきり述べさせる。実行するかどうかは本人が決めるので、
 *   「どちらとも言えます」で終わる回答は判断の助けにならない。
 *   曖昧に逃げられると、相談者が自分で結論を出すことになり相談の意味が薄れる。
 * - 渡した数字だけを使わせる。株価や指標を推測で書かせると、
 *   一見もっともらしい嘘が混ざり、履歴として読み返せなくなる。
 * - 借入とレバレッジに必ず触れさせる。買い増しは借入を増やす行為なので、
 *   これを無視した「買ってよい」は判断材料として不完全になる。
 * - 前のやり取りを踏まえて答える。同じ説明を繰り返させない。
 */
import { invokeLLM } from "../_core/llm";
import type { ConsultContext, ConsultHolding } from "./consultContext";

export const CONSULT_MODEL = "gemini-3-flash-preview";

/**
 * 過去のやり取りをいくつ渡すか。
 *
 * 全部渡すと会話が伸びるほどトークンを食い、古い前提（当時の株価）が
 * 今の質問に混ざる。直近だけで文脈は足りる。
 */
export const HISTORY_LIMIT = 8;

const SYSTEM = `あなたは長期保有を前提とする個人投資家の相談相手です。

相談者の状況:
- 複数の証券口座（moomoo 日本・楽天証券・IBKR シンガポール・渣打銀行・富途香港）で
  日本株・米国株・シンガポール株・香港株を保有している。
- IBKR で日本円を借りて信用取引をしている。買い増しは借入の増加につながる。
- 買った株は基本的に持ち続ける方針。頻繁な売買はしない。
- 画面を見るのは月に 1 回程度。
- 実行するかどうかは相談者自身が決める。実行した結果は口座のスクリーンショットから
  システムが把握できるため、後から判断の当否を検証できる。

守ること:
- 与えられた数字だけを使う。株価・指標・業績を自分で推測して書かない。
  数字が渡されていないことは「渡された情報では確認できない」と書く。
- 結論を最初に 1 文で言い切る。「買い増してよい」「見送るべき」「返済を優先すべき」
  のように、相談者が次に何をすればよいか分かる形で述べる。
  「どちらとも言えます」「判断が分かれます」で終わらせない。
  判断に必要な数字が渡されていない場合も、渡された数字の範囲で
  「現時点ではこうすべき」と述べ、そのうえで不足している情報を挙げる。
- 結論には必ず具体的な数量か価格を添える。「買い増してよい」だけでは実行できない。
  いくらまで（金額）、どの価格帯で、という水準を渡された数字から示す。
- 結論を覆す条件を 1 つ挙げる。何が起きたら考えを変えるべきかを書く。
- 買い増しの相談では必ず借入とレバレッジへの影響に触れる。
  現金で買えるのか、借入が増えるのかで意味が変わる。
- 借入に関する相談では、借入金利と現金性資産の利回りを必ず比べる。
  どちらが高いかで「返すべきか置いておくべきか」の答えが変わる。
- 同じ銘柄について過去に相談した記録が渡されている場合は、必ずそれに触れる。
  前回と同じ結論なら「前回と同じ判断」と述べ、変わったなら
  「前回はこう判断したが、〜が変わったため結論を変える」と理由を明示する。
  過去に触れずに答えると、同じ質問に毎回違う答えを返すことになる。
- 投資カードのエグジット条件が渡されている場合は、その条件に照らして判断する。
  条件に該当していないなら「まだ降りる条件は満たしていない」と述べる。
- 業種や市場の偏りが相談内容に関係する場合は指摘する。
- 飾った表現を使わない。事実と根拠を並べる。
- 日本語で答える。Markdown の見出し（##）と箇条書きを使って読みやすくする。
- 長くしすぎない。600 字程度を目安にする。`;

function fmtJpy(v: number | null | undefined): string {
  if (v === null || v === undefined) return "不明";
  return `${Math.round(v).toLocaleString("ja-JP")} 円`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "不明";
  return `${v.toFixed(2)}%`;
}

function holdingLine(h: ConsultHolding): string {
  const parts = [
    `${h.name}（${h.symbol}・${h.market}）`,
    `評価額 ${fmtJpy(h.valueJpy)}`,
    `構成比 ${h.sharePct.toFixed(1)}%`,
  ];
  if (h.price !== null) parts.push(`現在値 ${h.price} ${h.currency}`);
  if (h.avgCost !== null) parts.push(`取得単価 ${h.avgCost} ${h.currency}`);
  if (h.pnlPct !== null) parts.push(`損益 ${fmtPct(h.pnlPct)}`);
  if (h.dividendYieldPct !== null) parts.push(`利回り ${fmtPct(h.dividendYieldPct)}`);
  if (h.sector) parts.push(`業種 ${h.sector}`);
  if (h.bandLabel) parts.push(`買い増しプラン判定「${h.bandLabel}」`);
  return `- ${parts.join(" / ")}`;
}

/**
 * 保有状況を文章にする。
 *
 * JSON をそのまま渡すのではなく文章にしているのは、
 * どの数字が何を指すかを言葉で添えないと AI が単位を取り違えるため
 * （円と現地通貨、率と倍率が混ざる）。
 */
export function buildContextText(ctx: ConsultContext): string {
  const lines: string[] = [];

  lines.push("## 現在の保有状況（すべて税引前・円換算。現在値と取得単価のみ現地通貨）");
  lines.push(`- 株式時価: ${fmtJpy(ctx.totalValueJpy)}（${ctx.positionCount} 銘柄）`);
  lines.push(`- 現金性資産: ${fmtJpy(ctx.cashJpy)}`);
  if (ctx.borrowedJpy > 0) {
    lines.push(`- 借入: ${fmtJpy(ctx.borrowedJpy)}（IBKR で日本円を借り入れ）`);
    lines.push(`- 純資産（借入を差し引いた額）: ${fmtJpy(ctx.netAssetsJpy)}`);
    if (ctx.leverage !== null) {
      lines.push(
        `- レバレッジ: ${ctx.leverage.toFixed(2)} 倍（株式時価 ÷ 純資産。1.0 なら借入なし）`
      );
    }
    if (ctx.annualInterestJpy !== null) {
      lines.push(`- 年間の借入金利負担: ${fmtJpy(ctx.annualInterestJpy)}`);
    }
    /*
     * 実効金利は必ず渡す。額だけでは「買い増しの期待収益がコストを
     * 上回るか」を判定できず、AI が「利率は確認できません」と書いて
     * 結論を保留してしまう。
     */
    if (ctx.borrowRatePct !== null) {
      lines.push(
        `- 借入の実効金利: 年 ${fmtPct(ctx.borrowRatePct)}（借入額での加重平均）`
      );
    }
    if (ctx.brokerLeverage.length > 0) {
      lines.push("- 口座別の借入とレバレッジ（追証は口座単位で発生する）:");
      for (const b of ctx.brokerLeverage) {
        const parts = [`借入 ${fmtJpy(b.borrowedJpy)}`];
        if (b.leverage !== null) parts.push(`レバレッジ ${b.leverage.toFixed(2)} 倍`);
        if (b.ratePct !== null) parts.push(`金利 年 ${fmtPct(b.ratePct)}`);
        if (b.marginRatioPct !== null)
          parts.push(`証拠金維持率 ${b.marginRatioPct.toFixed(0)}%`);
        if (b.dropToMarginCallPct !== null)
          parts.push(`追証まで株価下落 ${b.dropToMarginCallPct.toFixed(1)}%`);
        lines.push(`  - ${b.broker}: ${parts.join(" / ")}`);
      }
    }
  } else {
    lines.push("- 借入: なし");
  }
  /*
   * 現金性資産（貨幣市場基金）は株式時価に含まれない別枠。
   * 「返すか買うか置いておくか」の三択を比べるのに必要で、
   * これを渡さないと借入の相談で選択肢が 2 つに減ってしまう。
   */
  if (ctx.interestAssetsJpy > 0) {
    lines.push(
      `- 利息で増える現金性資産（貨幣市場基金）: ${fmtJpy(ctx.interestAssetsJpy)}` +
        `（年間利息 ${fmtJpy(ctx.interestIncomeJpy)}・実効利回り ${fmtPct(ctx.interestRatePct)}）`
    );
    if (ctx.carrySpreadPct !== null) {
      const verdict =
        ctx.carrySpreadPct > 0
          ? "利回りが金利を上回っており、借入を返さず現金で置く方が有利"
          : "金利が利回りを上回っており、返済に回した方が負担が減る";
      lines.push(
        `- 現金の利回りと借入金利の差: ${ctx.carrySpreadPct > 0 ? "+" : ""}${fmtPct(ctx.carrySpreadPct)}（${verdict}）`
      );
    }
  }
  lines.push(
    `- 年間配当（見込み）: ${fmtJpy(ctx.annualDividendJpy)}（利回り ${fmtPct(ctx.dividendYieldPct)}）`
  );
  if (ctx.usdJpyRate) lines.push(`- USD/JPY: ${ctx.usdJpyRate.toFixed(2)} 円`);

  if (ctx.markets.length > 0) {
    lines.push("");
    lines.push("## 市場別の構成比");
    for (const m of ctx.markets) {
      lines.push(`- ${m.market}: ${m.sharePct.toFixed(1)}%`);
    }
  }

  if (ctx.sectors.length > 0) {
    lines.push("");
    lines.push("## 配当の業種別の割合（年間配当に対する比率）");
    for (const s of ctx.sectors) {
      lines.push(`- ${s.sector}: ${s.sharePct.toFixed(1)}%`);
    }
  }

  if (ctx.focus) {
    lines.push("");
    lines.push("## 相談対象の銘柄（保有中）");
    lines.push(holdingLine(ctx.focus));
  } else if (ctx.focusSymbol) {
    lines.push("");
    lines.push(
      `## 相談対象の銘柄: ${ctx.focusSymbol}（現在は保有していない。株価などの数値は渡されていないため推測で書かないこと）`
    );
  }

  if (ctx.focusNews.length > 0) {
    lines.push("");
    lines.push("## 相談対象銘柄の直近ニュース");
    for (const n of ctx.focusNews) {
      const impact = n.impactScore !== null ? `影響度 ${n.impactScore}` : "影響度 未評価";
      lines.push(`- ${n.title}（${impact}）${n.summary ? ` — ${n.summary}` : ""}`);
    }
  } else if (ctx.focusSymbol) {
    lines.push("");
    lines.push(
      "## 相談対象銘柄の直近ニュース: 取得できていない。ニュースを根拠にした記述はしないこと"
    );
  }

  if (ctx.addZone.length > 0) {
    lines.push("");
    lines.push("## 現在買い増しの価格帯に入っている銘柄（他の選択肢として）");
    for (const a of ctx.addZone) {
      lines.push(`- ${a.name}（${a.symbol}）: ${a.label}`);
    }
  }

  lines.push("");
  lines.push("## 評価額上位の保有銘柄");
  for (const h of ctx.topHoldings) {
    lines.push(holdingLine(h));
  }

  return lines.join("\n");
}

/**
 * 過去の判断を文章に足す。
 *
 * buildContextText の末尾ではなく相談対象の直後に置きたいが、
 * 順序を変えると既存のテストが壊れるため関数を分け、
 * askAdvisor で別のメッセージとして渡す。
 * 「これは過去の記録である」と明示的に分けた方が、AI が
 * 当時の株価を今の数字と混同しにくい。
 */
export function buildHistoryText(ctx: ConsultContext): string | null {
  const lines: string[] = [];

  if (ctx.focusCard) {
    lines.push(`## ${ctx.focusSymbol} の投資カード（過去に記録した判断）`);
    if (ctx.focusCard.coreThesis)
      lines.push(`- なぜ持っているか: ${ctx.focusCard.coreThesis}`);
    if (ctx.focusCard.valuationAssumption)
      lines.push(`- 前提: ${ctx.focusCard.valuationAssumption}`);
    if (ctx.focusCard.exitConditions)
      lines.push(`- 降りる条件: ${ctx.focusCard.exitConditions}`);
    if (ctx.focusCard.risks) lines.push(`- 想定リスク: ${ctx.focusCard.risks}`);
  }

  if (ctx.pastConsults.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## ${ctx.focusSymbol} について過去にした相談（古い株価が含まれる点に注意）`);
    for (const p of ctx.pastConsults) {
      lines.push(`### ${p.askedAt}: ${p.question}`);
      lines.push(p.answerHead);
      lines.push("");
    }
  }

  /*
   * 提案の実績を渡す。
   *
   * 自分の過去の結論が当たったか外れたかを踏まえさせるため。
   * 判定済みが 0 件のときは何も渡さない。「0 勝 0 敗」と書くと
   * AI が実績の少なさを言い訳にして結論を曖昧にする恐れがある。
   */
  const rec = ctx.adviceRecord;
  if (rec && rec.judged > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## これまでの提案の実績（あなた自身の判断の当否）");
    lines.push(`- 判定済み ${rec.judged} 件のうち 正しかった ${rec.correct} 件 / 外れた ${rec.wrong} 件`);
    for (const s of rec.byStance) {
      const label =
        s.stance === "BUY"
          ? "買いを勧めた判断"
          : s.stance === "HOLD"
            ? "見送りを勧めた判断"
            : s.stance === "REDUCE"
              ? "売却を勧めた判断"
              : "借入返済を勧めた判断";
      lines.push(`- ${label}: ${s.correct} 勝 ${s.wrong} 敗`);
    }
    lines.push(
      "外れが多い側の判断では、根拠をより厳しく確認してから結論を出すこと。"
    );
  }

  /*
   * この銘柄に対する提案の履歴（実行したかどうかを含む）。
   *
   * 「勧めたが実行されなかった」ことが分かると、同じ提案を繰り返す前に
   * 理由を確認できる。
   */
  if (rec && rec.symbolHistory.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## ${ctx.focusSymbol} に対する過去の提案と実行状況`);
    for (const h of rec.symbolHistory) {
      const stance =
        h.stance === "BUY"
          ? "買い"
          : h.stance === "HOLD"
            ? "見送り"
            : h.stance === "REDUCE"
              ? "売却"
              : "返済";
      const done =
        h.executed === null ? "実行の判定前" : h.executed ? "実行された" : "実行されなかった";
      const verdict =
        h.verdict === "CORRECT"
          ? "結果は正しかった"
          : h.verdict === "WRONG"
            ? "結果は外れた"
            : "結果は未判定";
      lines.push(`- ${h.createdAt} ${stance}を提案 → ${done} / ${verdict}: ${h.conclusion}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export type ConsultTurn = { role: "USER" | "ASSISTANT"; content: string };

/**
 * 相談に答える。
 *
 * 文脈は毎回作り直して渡す。会話の途中で株価が動くことがあり、
 * 最初の 1 回だけ渡す設計だと古い前提で答え続けてしまう。
 */
export async function askAdvisor(params: {
  question: string;
  context: ConsultContext;
  history: ConsultTurn[];
}): Promise<{ answer: string; model: string }> {
  const { question, context, history } = params;

  const recent = history.slice(-HISTORY_LIMIT);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    {
      role: "system",
      content: `以下は相談者の現在の保有状況です。回答ではこの数字だけを使ってください。\n\n${buildContextText(context)}`,
    },
  ];

  /*
   * 過去の判断は現在の状況とは別のメッセージで渡す。
   * 同じ塊に混ぜると、当時の株価を今の値段として扱う恐れがある。
   */
  const historyText = buildHistoryText(context);
  if (historyText) {
    messages.push({
      role: "system",
      content:
        `以下はこの銘柄について過去に記録した判断です。` +
        `今回の回答では必ずこれに触れ、同じ結論なのか変わったのかを明示してください。` +
        `ここに書かれた株価は当時の値であり、現在値としては使わないでください。\n\n${historyText}`,
    });
  }

  for (const turn of recent) {
    messages.push({
      role: turn.role === "USER" ? "user" : "assistant",
      content: turn.content,
    });
  }
  messages.push({ role: "user", content: question });

  const res = await invokeLLM({
    model: CONSULT_MODEL,
    messages,
    /*
     * 構造化出力にしない。相談は自由な文章の方が伝わる。
     * 項目を固定すると、当てはまらない項目を無理に埋めることになる。
     */
    maxTokens: 4096,
  });

  /*
   * content は文字列の場合と、部品の配列の場合がある。
   * 配列のときに文字列として扱うと "[object Object]" が保存され、
   * 履歴として読めなくなるので、テキスト部分だけを取り出して繋ぐ。
   */
  const raw = res.choices?.[0]?.message?.content;
  const answer = (
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map(part => (part && "text" in part && typeof part.text === "string" ? part.text : ""))
            .join("")
        : ""
  ).trim();
  if (!answer) {
    /*
     * 空の回答を保存すると履歴に空欄が残り、後から読んでも
     * 失敗したのか AI が答えなかったのか区別できない。
     */
    throw new Error("AI から回答が得られませんでした。もう一度お試しください");
  }
  return { answer, model: CONSULT_MODEL };
}

/**
 * 会話の題名を質問から作る。
 *
 * AI に別途作らせると呼び出しが 2 回になり時間と費用が倍になる。
 * 一覧で探せれば十分なので、質問の冒頭を切り出す。
 */
export function buildTitle(question: string, symbol?: string | null): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  const head = cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
  return symbol ? `[${symbol}] ${head}`.slice(0, 200) : head.slice(0, 200) || "相談";
}
