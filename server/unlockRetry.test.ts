/**
 * パスコード解錠の失敗分類と再試行のテスト。
 *
 * 実際に起きた不具合（デプロイ中に HTML が返り
 * 「Unexpected token '<', "<html><hea"... is not valid JSON」と表示された）
 * を再現し、同じ状態で自動的に解錠できることを固定する。
 */
import { describe, expect, it } from "vitest";
import {
  classifyUnlockFailure,
  isRetryableUnlockFailure,
  unlockFailureMessage,
  unlockWithRetry,
} from "../shared/unlockRetry";

describe("解錠の失敗分類", () => {
  it("実際に表示された文面をサーバー準備中と判定する", () => {
    // 画面に出ていた文面そのもの
    const err = new Error(`Unexpected token '<', " <html><hea"... is not valid JSON`);
    expect(classifyUnlockFailure(err)).toBe("SERVER_NOT_READY");
    expect(isRetryableUnlockFailure("SERVER_NOT_READY")).toBe(true);
  });

  it("Firefox の文面も同じ扱いにする", () => {
    const err = new Error("JSON.parse: unexpected character at line 1 column 1");
    expect(classifyUnlockFailure(err)).toBe("SERVER_NOT_READY");
  });

  it("応答が途中で切れた場合も準備中として扱う", () => {
    expect(classifyUnlockFailure(new Error("Unexpected end of JSON input"))).toBe(
      "SERVER_NOT_READY"
    );
  });

  it("パスコード違いは再試行しない", () => {
    // 再試行すると間違ったパスコードで何度も試すことになる
    const err = new Error("パスコードが違います");
    expect(classifyUnlockFailure(err)).toBe("WRONG_PASSCODE");
    expect(isRetryableUnlockFailure("WRONG_PASSCODE")).toBe(false);
  });

  it("通信できない場合は再試行する", () => {
    expect(classifyUnlockFailure(new Error("Failed to fetch"))).toBe("NETWORK");
    expect(isRetryableUnlockFailure("NETWORK")).toBe(true);
  });

  it("文面は原因と次の行動が分かる内容にする", () => {
    // 「Unexpected token」のような内部的な文面は出さない
    expect(unlockFailureMessage("SERVER_NOT_READY")).toContain("数秒おいて");
    expect(unlockFailureMessage("WRONG_PASSCODE")).toBe("パスコードが違います。");
    expect(unlockFailureMessage("SERVER_NOT_READY")).not.toContain("JSON");
  });
});

describe("解錠の再試行", () => {
  const noSleep = async () => {};

  it("1 回目が HTML でも 2 回目で解錠できる", async () => {
    let calls = 0;
    const result = await unlockWithRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error(`Unexpected token '<', " <html><hea"... is not valid JSON`);
        return { token: "ok" };
      },
      { sleep: noSleep }
    );
    expect(result).toEqual({ token: "ok" });
    expect(calls).toBe(2);
  });

  it("パスコード違いは 1 回で諦め、分かりやすい文面にする", async () => {
    let calls = 0;
    await expect(
      unlockWithRetry(
        async () => {
          calls++;
          throw new Error("パスコードが違います");
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow("パスコードが違います。");
    // 再試行していないこと（無駄な通信をしない）
    expect(calls).toBe(1);
  });

  it("ずっと HTML が返る場合は 3 回試して諦める", async () => {
    let calls = 0;
    await expect(
      unlockWithRetry(
        async () => {
          calls++;
          throw new Error("is not valid JSON");
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow("サーバーの準備中です");
    // 初回 + 再試行 2 回。無制限に粘ると画面が固まったように見える
    expect(calls).toBe(3);
  });

  it("成功する場合は再試行しない", async () => {
    let calls = 0;
    await unlockWithRetry(
      async () => {
        calls++;
        return { token: "t" };
      },
      { sleep: noSleep }
    );
    expect(calls).toBe(1);
  });
});

