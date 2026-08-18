/**
 * 保有ポートフォリオの偏りを起点に、新規候補銘柄を AI に提案させる。
 *
 * 設計の前提:
 * AI に「今後有望な株を挙げて」と聞くと、学習データに多く出てくる有名銘柄
 * （NVIDIA / Palantir / TSMC など）が並ぶだけになり、提案として意味がない。
 * しかもそれらは既に高値圏にあることが多く、「買いたい値段まで待つ」という
 * この投資家の方針と合わない。
 *
 * そこで出発点をポートフォリオにする。112 銘柄・8 億円分の実データから
 * 「何が足りないか」を先に数字で出し、その穴を埋める候補を挙げさせる。
 * こうすれば「なぜこの銘柄なのか」が保有データから説明できる。
 */
import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";

export const CANDIDATE_MODEL = "gemini-3-flash-preview";

/** 提案の起点になる「偏り」の記述 */
export type PortfolioGap = {
  /** 偏りの種類 */
  kind: "SECTOR" | "REGION" | "YIELD" | "RISK";
  /** 何が偏っているか（表示用） */
  label: string;
  /** 数字による裏付け。これがない指摘は出さない */
  evidence: string;
};

/**
 * 提案の系統。
 *
 * EXPAND（関心を広げる）は保有とウォッチリストに現れている産業を起点に、
 * 同じ性質でまだ持っていない銘柄を挙げる。
 * FILL（穴を埋める）は持っていない・薄い業種や地域を起点に挙げる。
 *
 * 系統を分けるのは、片方だけでは必ず偏るため。EXPAND だけだと半導体を
 * さらに増やす方向にしか進まず、レバレッジ 1.18 倍の状態で同じ材料で
 * 動く銘柄が増えて下落耐性が落ちる。FILL だけだと関心のない業種の
 * 銘柄ばかり並び、結局検討されない。
 */
export type SuggestionTrack = "EXPAND" | "FILL";

/** 関心が集まっている産業（AI に渡す形） */
export type InterestLine = {
  industry: string;
  sector: string | null;
  heldCount: number;
  watchCount: number;
  weightPct: number;
  symbols: string[];
};

export type SuggesterContext = {
  /** 総資産（円） */
  totalValueBase: number;
  /** 借入（円）。レバレッジがあるなら下落耐性を重視する必要がある */
  borrowedBase: number;
  /** 全体のレバレッジ倍率 */
  leverage: number | null;
  /** 配当利回り（%） */
  dividendYieldPct: number | null;
  /** 借入金利（%）。配当との差が薄いと利回り改善が課題になる */
  borrowRatePct: number | null;
  /** セクター別の構成比 */
  sectors: Array<{ label: string; pct: number; count: number }>;
  /** 市場別の構成比 */
  markets: Array<{ label: string; pct: number; count: number }>;
  /** 構成比上位の銘柄。同じ材料で動く銘柄が並んでいないかの判断に使う */
  topHoldings: Array<{ name: string; symbol: string; pct: number; sector: string | null }>;
  /** 既に保有している銘柄コード。重複提案を防ぐ */
  heldSymbols: string[];
  /** 既にウォッチリストにある銘柄コード。重複提案を防ぐ */
  watchedSymbols: string[];
  /**
   * 関心が集まっている産業（関心の強い順）。
   * 「同じ性質でまだ持っていない銘柄」を挙げさせる起点になる。
   */
  interests: InterestLine[];
  /**
   * 検討中の銘柄の中身。産業だけでは「なぜ見ているか」が分からないため、
   * 注目理由も渡して関心の方向を掴ませる。
   */
  watchDetails: Array<{
    symbol: string;
    name: string;
    industry: string | null;
    reason: string | null;
  }>;
  /** 持っていない・薄い業種 */
  sectorGaps: Array<{ sector: string; heldCount: number; weightPct: number }>;
  /** 前回までに提案したことがある銘柄。同じものを繰り返さないため */
  previouslySuggested: string[];
};

export type SuggestedCandidate = {
  /** 銘柄名 */
  name: string;
  /** Yahoo Finance 形式のシンボル（7203.T / AAPL / D05.SI / 0005.HK） */
  symbol: string;
  /** 市場 */
  market: "JP" | "US" | "SG" | "HK" | "OTHER";
  /**
   * どの系統の提案か。
   * 画面で「関心を広げる」「穴を埋める」に分けて出すために必要。
   */
  track: SuggestionTrack;
  /**
   * EXPAND の場合、どの産業を起点にした提案か。
   * 「半導体に関心があるので」という繋がりを画面に出すために使う。
   */
  basedOn: string | null;
  /** どの穴を埋める提案か */
  gapKind: "SECTOR" | "REGION" | "YIELD" | "RISK";
  /** なぜこの銘柄か。保有データとの関係を必ず書かせる */
  reason: string;
  /** 想定される懸念。良い面だけ挙げさせない */
  concern: string;
  /** 優先度 */
  priority: "HIGH" | "MEDIUM" | "LOW";
  /**
   * 買いたい値段（現地通貨）。
   * 「いくらになったら買うか」が出ないと機会損失を防げないため必須にする。
   * 現在値そのままではなく、待つ価値のある水準を書かせる。
   */
  targetPrice: number;
  /** その値段にした根拠。数字だけ出しても信用できない */
  targetBasis: string;
};

export type SuggesterResult = {
  /** 検出した偏り */
  gaps: PortfolioGap[];
  /** 候補銘柄 */
  candidates: SuggestedCandidate[];
  /** 全体の考え方 */
  overview: string;
};

const SUGGESTER_SYSTEM = `あなたは長期保有を前提とする個人投資家のポートフォリオを分析し、
新規候補銘柄を挙げるアナリストです。

この投資家の特徴:
- 株を買ったら長期で持ち続ける。短期の売買はしない
- 買うタイミングは「株価がこの水準まで下がったら買う」という段組みで決めている
- 既に 100 銘柄以上を保有しており、幅広く分散している
- 配当を重視する。借入をしているため、配当が金利負担を上回るかを見ている

## あなたの仕事：2 つの系統で候補を挙げる

### 系統 1: EXPAND（関心を広げる）

保有と検討中の銘柄に現れている「関心のある産業」を起点に、
同じ性質でまだ持っていない銘柄を挙げる。

この投資家が既に半導体を 7 銘柄持ち、さらに 4 銘柄を検討中なら、
それは半導体に強い関心があるということ。同じ産業・隣接する産業で
まだ見ていない銘柄を挙げる。

- **必ず basedOn にどの産業を起点にしたかを書く**（例: "Semiconductors"）
- 起点にする産業は提示された「関心のある産業」の一覧から選ぶこと。
  一覧にない産業を勝手に起点にしてはならない
- 隣接産業も可（半導体 → 半導体製造装置、EDA ツール、電力インフラなど）。
  ただし reason に「なぜ隣接と言えるか」を書くこと

### 系統 2: FILL（穴を埋める）

持っていない業種・薄い業種・地域の偏りを起点に挙げる。
こちらは basedOn を null にし、gapKind でどの穴かを示す。

### なぜ 2 系統に分けるか

EXPAND だけでは同じ材料で動く銘柄が増え、借入をしている状態で
下落耐性が落ちる。FILL だけでは関心のない業種の銘柄が並び、
結局検討されない。両方を挙げること。

**EXPAND を 3〜5 銘柄、FILL を 2〜4 銘柄**とし、合計 5〜8 銘柄にする。

## 絶対に守る原則

1. **有名だから挙げる、話題だから挙げるは禁止。**
   必ず「保有データのこの産業に関心があるため」または
   「この業種が薄いため」という理由から出発すること。
   NVIDIA や Palantir のような人気銘柄を理由なく挙げてはならない。

2. **既に保有している銘柄、既にウォッチリストにある銘柄は挙げない。**
   提示された保有銘柄コードの一覧を必ず確認すること。
   過去に提案した銘柄も避ける（一覧が提示されている場合）。

3. **偏りの指摘には必ず数字の裏付けを書く。**
   「テクノロジーが多い」ではなく「テクノロジーが 23 銘柄・全体の X% を占める」と書く。

4. **買いたい値段は現在値から 5〜25% 下の範囲で出す。**
   この投資家は「安くなったら買う」やり方だが、現在値から 30% 以上下の値段は
   実質「買わない」と同じで、待っているうちに買い場を逃す。
   52 週安値や過去の調整局面の水準を参考に、実際に届きうる値段にすること。
   30% 以上下の値段を出した場合はシステムが自動で引き上げる。

4. **各候補に必ず懸念（concern）を書く。**
   良い面だけを挙げてはならない。買わない理由になりうる点を必ず添える。
   懸念が書けない銘柄は挙げるべきではない。

5. **シンボルは Yahoo Finance の形式で正確に書く。**
   - 日本株: 4 桁コード + .T（例: 7203.T）
   - 米国株: ティッカーのみ（例: AAPL）
   - シンガポール株: コード + .SI（例: D05.SI）
   - 香港株: 4 桁ゼロ埋め + .HK（例: 0005.HK）
   存在しないシンボルを書いてはならない。確信が持てない銘柄は挙げない。

6. **断定的な売買推奨はしない。**
   「買うべき」ではなく「候補として検討する価値がある」という書き方にする。
   最終判断は投資家本人が行う。

7. **レバレッジをかけている場合、下落耐性を重視する。**
   借入がある状態で値動きの激しい銘柄を増やすと、追証リスクが上がる。

## 候補の数

5〜8 銘柄。多く挙げるより、根拠のあるものだけに絞ること。
同じ穴を埋める候補が複数ある場合は最も適したものを 1〜2 個に絞る。

## 買いたい値段（targetPrice）の決め方

この投資家は「今すぐ買う」のではなく「この値段まで下がったら買う」という待ち方をする。
そのため候補ごとに必ず買いたい値段を 1 つ挙げること。

- **現地通貨の実際の株価水準で書く。** 日本株なら円、米国株なら米ドル、
  香港株なら香港ドル、シンガポール株ならシンガポールドル。通貨換算はしない。
- **現在値そのまま、または現在値より高い値段を書いてはならない。**
  それでは「待つ」意味がなく、機会損失を防ぐ目的を果たせない。
- 目安は現在値より 5〜20% 低い水準。ただし機械的に何 % 下と決めるのではなく、
  52週レンジの下位、配当利回りが妥当になる水準、過去の調整幅などから判断する。
- **targetBasis にその値段の根拠を必ず書く。**
  「配当利回りが 5% に達する水準」「52週安値圏で過去 2 回反発した水準」のように、
  なぜその数字なのかが分かるように書く。根拠が書けない数字は出してはならない。`;

const SUGGESTER_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "candidate_suggestions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["gaps", "candidates", "overview"],
      properties: {
        overview: { type: "string" },
        gaps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "label", "evidence"],
            properties: {
              kind: { type: "string", enum: ["SECTOR", "REGION", "YIELD", "RISK"] },
              label: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        candidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "symbol",
              "market",
              "track",
              "basedOn",
              "gapKind",
              "reason",
              "concern",
              "priority",
              "targetPrice",
              "targetBasis",
            ],
            properties: {
              name: { type: "string" },
              symbol: { type: "string" },
              market: { type: "string", enum: ["JP", "US", "SG", "HK", "OTHER"] },
              track: { type: "string", enum: ["EXPAND", "FILL"] },
              basedOn: { type: ["string", "null"] },
              gapKind: { type: "string", enum: ["SECTOR", "REGION", "YIELD", "RISK"] },
              reason: { type: "string" },
              concern: { type: "string" },
              priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
              targetPrice: { type: "number" },
              targetBasis: { type: "string" },
            },
          },
        },
      },
    },
  },
};

function pct(v: number | null): string {
  return v === null ? "データ未取得" : `${v.toFixed(2)}%`;
}

export function buildSuggesterPrompt(ctx: SuggesterContext): string {
  const sectorLines = ctx.sectors
    .map(s => `- ${s.label}: ${s.pct.toFixed(1)}%（${s.count} 銘柄）`)
    .join("\n");
  const marketLines = ctx.markets
    .map(m => `- ${m.label}: ${m.pct.toFixed(1)}%（${m.count} 銘柄）`)
    .join("\n");
  const topLines = ctx.topHoldings
    .map(h => `- ${h.name}（${h.symbol}）: ${h.pct.toFixed(1)}%／${h.sector ?? "セクター未取得"}`)
    .join("\n");

  /*
   * 関心のある産業。ここが EXPAND 系統の起点になる。
   * 検討中の件数を明示するのは、まだ買っていない銘柄を登録してあることが
   * 「これから買いたい」意思の表れであり、現在の関心を最もよく表すため。
   */
  const interestLines = ctx.interests
    .map(
      i =>
        `- ${i.industry}（${i.sector ?? "業種未取得"}）: 保有 ${i.heldCount} 銘柄` +
        `${i.watchCount > 0 ? `・検討中 ${i.watchCount} 銘柄` : ""}` +
        `／構成比 ${i.weightPct.toFixed(1)}%／${i.symbols.slice(0, 6).join(", ")}`
    )
    .join("\n");

  /*
   * 検討中の銘柄は理由まで渡す。産業名だけでは「なぜ見ているか」が
   * 分からず、AI が同じ産業の別銘柄を機械的に挙げるだけになる。
   * 理由は 120 字で切る（全文だと 13 銘柄でプロンプトが膨らむ）。
   */
  const watchLines = ctx.watchDetails
    .map(
      w =>
        `- ${w.name}（${w.symbol}／${w.industry ?? "産業未取得"}）: ` +
        `${w.reason ? w.reason.replace(/\s+/g, " ").slice(0, 120) : "理由未記入"}`
    )
    .join("\n");

  const gapLines = ctx.sectorGaps
    .map(
      g =>
        `- ${g.sector}: ${
          g.heldCount === 0
            ? "保有なし"
            : `${g.heldCount} 銘柄・${g.weightPct.toFixed(1)}% のみ`
        }`
    )
    .join("\n");

  /*
   * 保有銘柄コードは全件渡す。件数が多いが、ここを省略すると
   * 既に持っている銘柄を提案されて使えない結果になる。
   */
  return `## ポートフォリオの規模
- 総資産: ${Math.round(ctx.totalValueBase).toLocaleString("ja-JP")} 円
- 借入: ${Math.round(ctx.borrowedBase).toLocaleString("ja-JP")} 円
- 全体レバレッジ: ${ctx.leverage === null ? "なし" : `${ctx.leverage.toFixed(2)} 倍`}
- 配当利回り: ${pct(ctx.dividendYieldPct)}
- 借入金利: ${pct(ctx.borrowRatePct)}

## 関心のある産業（EXPAND 系統の起点。この一覧から選ぶこと）
${interestLines || "データなし"}

## 検討中の銘柄（まだ買っていないが登録してある＝これから買う意思がある）
${watchLines || "なし"}

## 持っていない・薄い業種（FILL 系統の起点）
${gapLines || "薄い業種はありません"}

## セクター別の構成比
${sectorLines || "データなし"}

## 市場（国）別の構成比
${marketLines || "データなし"}

## 構成比の大きい銘柄
${topLines || "データなし"}

## 既に保有している銘柄（提案してはならない）
${ctx.heldSymbols.join(", ")}

## 既にウォッチリストにある銘柄（提案してはならない）
${ctx.watchedSymbols.length > 0 ? ctx.watchedSymbols.join(", ") : "なし"}

## 過去に提案した銘柄（できるだけ避ける）
${ctx.previouslySuggested.length > 0 ? ctx.previouslySuggested.join(", ") : "なし"}

以上から、EXPAND（関心のある産業を起点に、同じ性質でまだ持っていない銘柄）を
3〜5 銘柄、FILL（薄い業種・地域の穴を埋める銘柄）を 2〜4 銘柄挙げてください。
EXPAND では basedOn に起点にした産業名を必ず書き、
FILL では basedOn を null にしてください。
各候補には必ず「なぜこの銘柄か」と「懸念点」を書いてください。`;
}

export async function suggestCandidates(ctx: SuggesterContext): Promise<SuggesterResult> {
  const res = await invokeLLM({
    model: CANDIDATE_MODEL,
    messages: [
      { role: "system", content: SUGGESTER_SYSTEM },
      { role: "user", content: buildSuggesterPrompt(ctx) },
    ],
    responseFormat: SUGGESTER_SCHEMA,
    // 候補 8 件それぞれに理由と懸念を日本語で書かせるため余裕を持たせる。
    // 足りないと JSON が途中で切れて解析に失敗する。
    maxTokens: 8192,
  });

  /*
   * 途中で切れた応答は JSON として壊れている。
   * パースエラーだけを見せると原因が分からないため先に判定する。
   */
  if (res.choices?.[0]?.finish_reason === "length") {
    throw new Error("候補銘柄の提案が途中で打ち切られました。もう一度お試しください。");
  }

  const parsed = parseLlmJson<SuggesterResult>(
    res.choices?.[0]?.message?.content,
    "候補銘柄の提案の応答"
  );

  /*
   * 既に保有・ウォッチ済みの銘柄が混ざっていたら捨てる。
   * プロンプトで禁止していても混ざることがあるため、コード側でも弾く。
   * ここを省くと「既に持っている銘柄を勧められる」という一番使えない結果になる。
   */
  const excluded = new Set(
    [...ctx.heldSymbols, ...ctx.watchedSymbols].map(s => s.trim().toUpperCase())
  );
  const candidates = parsed.candidates
    .filter(c => !excluded.has(c.symbol.trim().toUpperCase()))
    .map(c => normalizeTrack(c, ctx.interests));

  return { ...parsed, candidates };
}

/**
 * 系統と起点の整合を取る。
 *
 * AI は track を EXPAND にしながら basedOn を空にしたり、
 * 関心の一覧にない産業名を書いたりすることがある。そのままだと
 * 画面で「関心を広げる提案」の下に根拠のない銘柄が並ぶ。
 *
 * 起点が確認できないものは FILL に落とす。EXPAND として出すには
 * 「どの関心から来たか」が言えることが条件であり、それが言えないなら
 * 穴を埋める提案として扱う方が正確。
 */
export function normalizeTrack(
  c: SuggestedCandidate,
  interests: InterestLine[]
): SuggestedCandidate {
  if (c.track !== "EXPAND") {
    // FILL に起点が入っていても意味がないので落とす
    return { ...c, track: "FILL", basedOn: null };
  }

  const basedOn = c.basedOn?.trim();
  if (!basedOn) {
    return { ...c, track: "FILL", basedOn: null };
  }

  /*
   * 産業名の一致は大文字小文字を無視して比べる。
   * AI が "semiconductors" と小文字で返すことがあり、
   * 厳密一致だと正しい起点まで落としてしまう。
   */
  const known = interests.find(
    i => i.industry.toLowerCase() === basedOn.toLowerCase()
  );
  if (!known) {
    return { ...c, track: "FILL", basedOn: null };
  }

  return { ...c, track: "EXPAND", basedOn: known.industry };
}
