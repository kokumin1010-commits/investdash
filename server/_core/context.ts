import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyToken } from "../services/passcode";
import { getUserById } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/**
 * `Authorization: Bearer <token>` からパスコードセッションを解決する。
 * このアプリは Manus OAuth の代わりにパスコード認証を使うため、
 * まずこちらを優先して判定する。
 */
async function resolvePasscodeUser(
  req: CreateExpressContextOptions["req"]
): Promise<User | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const ownerUserId = await verifyToken(token);
  if (!ownerUserId) return null;

  return (await getUserById(ownerUserId)) ?? null;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // 1) パスコードセッションを優先
  try {
    user = await resolvePasscodeUser(opts.req);
  } catch (error) {
    console.warn("[Auth] passcode resolution failed:", error);
    user = null;
  }

  // 2) 従来の Manus OAuth（cron からの呼び出しなどで使う）
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
