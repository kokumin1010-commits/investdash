import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LLM 呼び出しをモックして、ニュース 0 件でもシグナル生成が最後まで通ることを確認する。
 * `invokeLLM` は実際の API を叩くため、モックしないとテストが利用枠に依存してしまう。
 */
const invokeLLM = vi.hoisted(() => vi.fn());
vi.mock("./_core/llm", () => ({ invokeLLM }));

const { buildSignalPrompt, generateSignal } = await import("./services/analysis");
type SignalContext = Parameters<typeof buildSignalPrompt>[0];

/**
 * ニュースが 1 件も取得できていない銘柄でも、価格データと投資カードだけで
 * シグナルを生成できる必要がある。ニュース取得は日次ジョブに依存するため、
 * 登録直後の銘柄は必ずニュース 0 件の状態を通る。
 */
function baseContext(overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    name: "野村ホールディングス",
    symbol: "8604.T",
    currency: "JPY",
    quantity: 7900,
    avgCost: 1132,
    currentPrice: 1570,
    pnlPct: 38.66,
    weightPct: 13.9,
    sector: "金融",
    industry: "証券",
    fiftyTwoWeekHigh: 1600,
    fiftyTwoWeekLow: 800,
    return1m: 5.2,
    return3m: 12.8,
    card: null,
    news: [],
    ...overrides,
  };
}

describe("buildSignalPrompt", () => {
  it("ニュース 0 件でもプロンプトが成立し、その旨が明示される", () => {
    const prompt = buildSignalPrompt(baseContext());

    expect(prompt).toContain("直近のニュースは取得されていません");
    // 価格側の判断材料は残っている
    expect(prompt).toContain("8604.T");
    expect(prompt).toContain("38.66");
    // 52 週レンジ内の位置が算出されている（1570 は 800〜1600 の 96%）
    expect(prompt).toMatch(/9[0-9]%（0%が年初来安値/);
  });

  it("投資カードが未作成でもプロンプトが成立する", () => {
    const prompt = buildSignalPrompt(baseContext({ card: null }));
    expect(prompt).toContain("投資カードは未作成です");
  });

  it("ニュースがある場合は判定と影響度が渡される", () => {
    const prompt = buildSignalPrompt(
      baseContext({
        news: [
          {
            title: "野村、通期見通しを上方修正",
            sentiment: "POSITIVE",
            impactScore: 4,
            summary: "手数料収入の増加が寄与",
            publishedAt: new Date("2026-08-14T00:00:00Z"),
          },
        ],
      })
    );

    expect(prompt).toContain("POSITIVE");
    expect(prompt).toContain("影響度4");
    expect(prompt).toContain("上方修正");
    expect(prompt).not.toContain("直近のニュースは取得されていません");
  });

  it("価格が未取得でも例外を投げない", () => {
    const prompt = buildSignalPrompt(
      baseContext({ currentPrice: null, pnlPct: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null })
    );
    expect(prompt).toContain("データ未取得");
  });
});

describe("generateSignal", () => {
  beforeEach(() => {
    invokeLLM.mockReset();
  });

  /** LLM が返す JSON を模したレスポンス */
  function mockResponse(payload: Record<string, unknown>) {
    invokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });
  }

  it("ニュース 0 件・投資カード未作成でもシグナルを返す", async () => {
    mockResponse({
      action: "HOLD",
      confidence: 62,
      rationale: "ニュースは未取得だが、取得単価から+38%で推移しており前提の崩れは見られない。",
      factors: ["取得単価から+38.66%", "52週レンジ上位"],
    });

    const result = await generateSignal(baseContext({ news: [], card: null }));

    expect(result.action).toBe("HOLD");
    expect(result.confidence).toBe(55);
    expect(result.dataQuality).toBe("LIMITED");
    expect(result.reviewTriggers).toEqual([]);
    expect(result.riskFlags).toEqual([]);
    expect(invokeLLM).toHaveBeenCalledOnce();

    // ニュース 0 件でもプロンプトが渡っていること
    const sent = invokeLLM.mock.calls[0][0] as { messages: { content: string }[] };
    expect(sent.messages[1].content).toContain("直近のニュースは取得されていません");
  });

  it("confidence が範囲外でも 0〜資料品質上限に収める", async () => {
    mockResponse({ action: "WATCH", confidence: 140, rationale: "テスト", factors: [] });
    expect((await generateSignal(baseContext())).confidence).toBe(55);

    mockResponse({ action: "WATCH", confidence: -20, rationale: "テスト", factors: [] });
    expect((await generateSignal(baseContext())).confidence).toBe(0);
  });

  it("LLM が文字列を返さない場合はエラーにする", async () => {
    invokeLLM.mockResolvedValue({ choices: [{ message: { content: null } }] });
    await expect(generateSignal(baseContext())).rejects.toThrow("シグナルの応答が空でした");
  });

  it("Markdown で返ってきても JSON を取り出して処理する", async () => {
    // claude 系がスキーマを無視して返す実際の形を再現
    invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '判定結果を提示します。\n```json\n{"action":"REDUCE","confidence":70,"rationale":"構成比が過大","factors":{}}\n```',
          },
        },
      ],
    });

    const result = await generateSignal(baseContext());
    expect(result.action).toBe("REDUCE");
    expect(result.confidence).toBe(55);
  });

  it("LLM 側の失敗はそのまま伝播する（上位でメッセージ変換する設計）", async () => {
    invokeLLM.mockRejectedValue(
      new Error('LLM invoke failed: 412 Precondition Failed – {"code":9,"message":"your account has hit a usage exhausted"}')
    );
    await expect(generateSignal(baseContext())).rejects.toThrow("usage exhausted");
  });
});
