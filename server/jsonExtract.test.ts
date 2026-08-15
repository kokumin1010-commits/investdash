import { describe, expect, it } from "vitest";
import { parseLlmJson } from "./services/jsonExtract";

/**
 * 内蔵プロキシではモデルによって JSON スキーマ指定が無視され Markdown が返る。
 * （実測: claude-sonnet-4-6 / claude-haiku-4-5 が該当）
 * モデル選定で回避しているが、プロキシの挙動変更に備えてパーサ側も守る。
 */
describe("parseLlmJson", () => {
  it("素の JSON をパースする", () => {
    expect(parseLlmJson<{ action: string }>('{"action":"HOLD"}').action).toBe("HOLD");
  });

  it("```json フェンス付きでもパースする", () => {
    const raw = '```json\n{"action":"REDUCE","confidence":72}\n```';
    const parsed = parseLlmJson<{ action: string; confidence: number }>(raw);
    expect(parsed.action).toBe("REDUCE");
    expect(parsed.confidence).toBe(72);
  });

  it("言語指定なしのフェンスでもパースする", () => {
    expect(parseLlmJson<{ a: number }>("```\n{\"a\":1}\n```").a).toBe(1);
  });

  it("前置きの文章があってもパースする（claude が返す実際の形）", () => {
    const raw =
      '野村HDの最新ニュースと株価情報を取得して、投資判定を行います。\n```json\n{"action":"HOLD","rationale":"ロジックに変化なし"}\n```';
    expect(parseLlmJson<{ action: string }>(raw).action).toBe("HOLD");
  });

  it("フェンスなしで文章に埋め込まれた JSON も取り出す", () => {
    const raw = '判定結果は以下です。 {"action":"WATCH","confidence":35} 以上。';
    expect(parseLlmJson<{ action: string }>(raw).action).toBe("WATCH");
  });

  it("ネストしたオブジェクトの括弧を正しく数える", () => {
    const raw =
      '説明文。{"action":"ADD","factors":{"priceAction":"上昇","valuation":"割安"}} 補足。';
    const parsed = parseLlmJson<{ factors: { valuation: string } }>(raw);
    expect(parsed.factors.valuation).toBe("割安");
  });

  it("文字列内の括弧に惑わされない", () => {
    const raw = '{"rationale":"取得単価から+38%（好調）で推移 {注記あり}","action":"HOLD"}';
    expect(parseLlmJson<{ action: string }>(raw).action).toBe("HOLD");
  });

  it("エスケープされた引用符を含む文字列を扱える", () => {
    const raw = '前置き {"rationale":"いわゆる \\"割安圏\\" にある","action":"ADD"}';
    expect(parseLlmJson<{ action: string }>(raw).action).toBe("ADD");
  });

  it("空文字・非文字列はエラーにする", () => {
    expect(() => parseLlmJson("", "シグナルの応答")).toThrow("シグナルの応答が空でした");
    expect(() => parseLlmJson(null)).toThrow("空でした");
    expect(() => parseLlmJson(undefined)).toThrow("空でした");
  });

  it("JSON が含まれない場合は先頭を添えてエラーにする", () => {
    expect(() => parseLlmJson("## 判定結果\n\n- HOLD です", "シグナルの応答")).toThrow(
      /シグナルの応答を解析できませんでした（先頭: ## 判定結果/
    );
  });
});

