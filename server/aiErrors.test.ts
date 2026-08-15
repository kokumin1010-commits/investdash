import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { isQuotaError, toFriendlyAiError } from "./services/aiErrors";

describe("toFriendlyAiError", () => {
  it("利用枠上限のエラーを対処法込みの日本語に変換する", () => {
    // 内蔵 LLM が実際に返す形式
    const raw = new Error(
      'LLM invoke failed: 412 Precondition Failed – {"code":9,"message":"your account has hit a usage exhausted"}'
    );
    const converted = toFriendlyAiError(raw, "失敗");

    expect(converted).toBeInstanceOf(TRPCError);
    expect(converted.code).toBe("TOO_MANY_REQUESTS");
    expect(converted.message).toContain("利用枠");
    expect(converted.message).toContain("時間をおいて");
    // 生のエラー文が漏れていないこと
    expect(converted.message).not.toContain("412");
    expect(converted.message).not.toContain("Precondition");
  });

  it("認証エラーは待っても直らないため別の文言にする", () => {
    const converted = toFriendlyAiError(new Error("401 Unauthorized"), "失敗");
    expect(converted.code).toBe("INTERNAL_SERVER_ERROR");
    expect(converted.message).toContain("認証");
  });

  it("タイムアウトは再試行を促す", () => {
    const converted = toFriendlyAiError(new Error("socket hang up"), "失敗");
    expect(converted.code).toBe("TIMEOUT");
    expect(converted.message).toContain("もう一度");
  });

  it("TRPCError はそのまま通す（二重変換を避ける）", () => {
    const original = new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
    expect(toFriendlyAiError(original, "失敗")).toBe(original);
  });

  it("想定外のエラーはメッセージを保持する", () => {
    const converted = toFriendlyAiError(new Error("something odd"), "失敗");
    expect(converted.code).toBe("INTERNAL_SERVER_ERROR");
    expect(converted.message).toBe("something odd");
  });
});

describe("isQuotaError", () => {
  it("利用枠上限を判定できる", () => {
    expect(isQuotaError(new Error("your account has hit a usage exhausted"))).toBe(true);
    expect(isQuotaError(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("無関係なエラーは false", () => {
    expect(isQuotaError(new Error("銘柄が見つかりません"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});
