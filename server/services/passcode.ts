/**
 * 簡易パスコード認証。
 *
 * Manus OAuth の代わりに 4〜6 桁の数字だけでアクセスできるようにする。
 * 単一オーナー専用ツールという前提で、パスコード 1 つがデータ所有者 1 人に対応する。
 *
 * 設計方針:
 * - パスコードは平文保存せず、ソルト付き SHA-256（100,000 回ストレッチ）で保持する
 * - 検証成功時に JWT を発行し、クライアントは localStorage に保存して以降のリクエストに付与する
 * - 総当たり対策として、連続 5 回失敗で 15 分間ロックする
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { passcodeAuth, users } from "../../drizzle/schema";
import { ENV } from "../_core/env";

/** 初期パスコード。初回アクセス時にこの値で自動セットアップされる */
const DEFAULT_PASSCODE = "1010";

/**
 * scrypt のコストパラメータ。
 *
 * パスコードは 4〜6 桁しかないため、ハッシュが漏れた場合の総当たりは
 * 桁数の少なさで決まる。scrypt はメモリも要求するため、単純な
 * ハッシュの反復より GPU による並列総当たりに強い。N=2^15 で 1 回
 * 約 0.1 秒程度に収まり、解錠時の待ち時間は体感しにくい。
 */
const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 32;

/** 連続失敗の許容回数 */
export const MAX_FAILED_ATTEMPTS = 5;

/** ロック時間（ミリ秒） */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/** トークンの有効期間 */
const TOKEN_TTL = "365d";

export const PASSCODE_MIN_LENGTH = 4;
export const PASSCODE_MAX_LENGTH = 6;

/** パスコードの形式を検証する */
export function isValidPasscodeFormat(passcode: string): boolean {
  return new RegExp(`^\\d{${PASSCODE_MIN_LENGTH},${PASSCODE_MAX_LENGTH}}$`).test(passcode);
}

/** ソルト付きハッシュを計算する */
export function hashPasscode(passcode: string, salt: string): string {
  return scryptSync(passcode, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: 128 * SCRYPT_COST * SCRYPT_BLOCK_SIZE * 2,
  }).toString("hex");
}

/** タイミング攻撃に配慮した比較 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret || "invest-desk-fallback-secret");
}

/** パスコードセッションのトークンを発行する */
export async function issueToken(ownerUserId: number): Promise<string> {
  return await new SignJWT({ scope: "passcode", ownerUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey());
}

/** トークンを検証し、所有者の users.id を返す */
export async function verifyToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.scope !== "passcode") return null;
    const ownerUserId = payload.ownerUserId;
    return typeof ownerUserId === "number" && ownerUserId > 0 ? ownerUserId : null;
  } catch {
    return null;
  }
}

/**
 * オーナー行を取得する。存在しない場合は既存の最初のユーザー、
 * それも無ければ新規に作成する。
 */
async function ensureOwnerUserId(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return existing[0].id;

  // ユーザーが 1 人も居ない場合はオーナー用の行を作る
  await db.insert(users).values({
    openId: ENV.ownerOpenId || "passcode-owner",
    name: "Owner",
    role: "admin",
  });
  const created = await db.select({ id: users.id }).from(users).limit(1);
  if (created.length === 0) throw new Error("オーナーの作成に失敗しました");
  return created[0].id;
}

/**
 * パスコード設定行を取得する。存在しなければ初期パスコードで作成する。
 */
export async function ensurePasscodeRow() {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  const rows = await db.select().from(passcodeAuth).limit(1);
  if (rows.length > 0) return rows[0];

  const ownerUserId = await ensureOwnerUserId();
  const salt = randomBytes(16).toString("hex");
  await db.insert(passcodeAuth).values({
    ownerUserId,
    passcodeSalt: salt,
    passcodeHash: hashPasscode(DEFAULT_PASSCODE, salt),
  });

  const created = await db.select().from(passcodeAuth).limit(1);
  return created[0];
}

export type UnlockResult =
  | { ok: true; token: string }
  | { ok: false; reason: "invalid-format" }
  | { ok: false; reason: "wrong"; remainingAttempts: number }
  | { ok: false; reason: "locked"; unlockAt: Date };

/** パスコードを検証してトークンを発行する */
export async function unlock(passcode: string): Promise<UnlockResult> {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  if (!isValidPasscodeFormat(passcode)) {
    return { ok: false, reason: "invalid-format" };
  }

  const row = await ensurePasscodeRow();

  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { ok: false, reason: "locked", unlockAt: row.lockedUntil };
  }

  const candidate = hashPasscode(passcode, row.passcodeSalt);
  if (!safeCompare(candidate, row.passcodeHash)) {
    const failed = row.failedAttempts + 1;
    const shouldLock = failed >= MAX_FAILED_ATTEMPTS;
    await db
      .update(passcodeAuth)
      .set({
        failedAttempts: shouldLock ? 0 : failed,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      })
      .where(eq(passcodeAuth.id, row.id));

    if (shouldLock) {
      return { ok: false, reason: "locked", unlockAt: new Date(Date.now() + LOCK_DURATION_MS) };
    }
    return { ok: false, reason: "wrong", remainingAttempts: MAX_FAILED_ATTEMPTS - failed };
  }

  await db
    .update(passcodeAuth)
    .set({ failedAttempts: 0, lockedUntil: null, lastUnlockedAt: new Date() })
    .where(eq(passcodeAuth.id, row.id));

  return { ok: true, token: await issueToken(row.ownerUserId) };
}

export type ChangeResult =
  | { ok: true }
  | { ok: false; reason: "invalid-format" }
  | { ok: false; reason: "wrong-current" };

/** パスコードを変更する */
export async function changePasscode(
  currentPasscode: string,
  newPasscode: string
): Promise<ChangeResult> {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  if (!isValidPasscodeFormat(newPasscode)) {
    return { ok: false, reason: "invalid-format" };
  }

  const row = await ensurePasscodeRow();
  const candidate = hashPasscode(currentPasscode, row.passcodeSalt);
  if (!safeCompare(candidate, row.passcodeHash)) {
    return { ok: false, reason: "wrong-current" };
  }

  const salt = randomBytes(16).toString("hex");
  await db
    .update(passcodeAuth)
    .set({
      passcodeSalt: salt,
      passcodeHash: hashPasscode(newPasscode, salt),
      failedAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(passcodeAuth.id, row.id));

  return { ok: true };
}

/** 初期パスコードのままかどうかを判定する（変更を促す表示に使う） */
export async function isUsingDefaultPasscode(): Promise<boolean> {
  const row = await ensurePasscodeRow();
  return safeCompare(hashPasscode(DEFAULT_PASSCODE, row.passcodeSalt), row.passcodeHash);
}
