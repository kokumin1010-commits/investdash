import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserById } from "../db";
import { verifyToken } from "../services/passcode";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

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

/**
 * tRPC 以外の保護ルートでも同じ認証規則を使う。
 * パスコードBearerを優先し、既存のManus OAuthセッションへフォールバックする。
 */
export async function resolveRequestUser(
  req: CreateExpressContextOptions["req"]
): Promise<User | null> {
  let user: User | null = null;

  try {
    user = await resolvePasscodeUser(req);
  } catch (error) {
    console.warn("[Auth] passcode resolution failed:", error);
  }

  if (!user) {
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      user = null;
    }
  }

  return user;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const user = await resolveRequestUser(opts.req);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
