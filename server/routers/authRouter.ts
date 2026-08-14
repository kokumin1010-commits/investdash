/**
 * 簡易パスコード認証のエンドポイント。
 * unlock は未認証で呼べる必要があるため publicProcedure を使う。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  MAX_FAILED_ATTEMPTS,
  PASSCODE_MAX_LENGTH,
  PASSCODE_MIN_LENGTH,
  changePasscode,
  isUsingDefaultPasscode,
  unlock,
} from "../services/passcode";

const passcodeInput = z
  .string()
  .regex(new RegExp(`^\\d{${PASSCODE_MIN_LENGTH},${PASSCODE_MAX_LENGTH}}$`), {
    message: `パスコードは ${PASSCODE_MIN_LENGTH}〜${PASSCODE_MAX_LENGTH} 桁の数字で入力してください`,
  });

export const authRouter = router({
  /** パスコード認証の仕様をクライアントに伝える */
  config: publicProcedure.query(() => ({
    minLength: PASSCODE_MIN_LENGTH,
    maxLength: PASSCODE_MAX_LENGTH,
    maxAttempts: MAX_FAILED_ATTEMPTS,
  })),

  /** パスコードを検証してトークンを発行する */
  unlock: publicProcedure
    .input(z.object({ passcode: z.string() }))
    .mutation(async ({ input }) => {
      const result = await unlock(input.passcode);

      if (result.ok) return { token: result.token };

      if (result.reason === "locked") {
        const minutes = Math.max(1, Math.ceil((result.unlockAt.getTime() - Date.now()) / 60000));
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `入力を続けて間違えたため一時的にロックされています。約 ${minutes} 分後に再度お試しください。`,
        });
      }

      if (result.reason === "invalid-format") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `パスコードは ${PASSCODE_MIN_LENGTH}〜${PASSCODE_MAX_LENGTH} 桁の数字です`,
        });
      }

      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: `パスコードが違います（あと ${result.remainingAttempts} 回で一時ロック）`,
      });
    }),

  /** 初期パスコードのままかどうか（変更を促す表示に使う） */
  usingDefaultPasscode: protectedProcedure.query(() => isUsingDefaultPasscode()),

  /** パスコードを変更する */
  changePasscode: protectedProcedure
    .input(z.object({ current: z.string(), next: passcodeInput }))
    .mutation(async ({ input }) => {
      const result = await changePasscode(input.current, input.next);

      if (result.ok) return { success: true } as const;

      if (result.reason === "wrong-current") {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "現在のパスコードが違います" });
      }

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `新しいパスコードは ${PASSCODE_MIN_LENGTH}〜${PASSCODE_MAX_LENGTH} 桁の数字で入力してください`,
      });
    }),
});
