import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
let tempDir = "";

describe("Railway volume storage", () => {
  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "investdash-storage-"));
    process.env.STORAGE_LOCAL_DIR = tempDir;
    process.env.PUBLIC_BASE_PATH = "/investdash";
    process.env.BUILT_IN_FORGE_API_URL = "";
    process.env.BUILT_IN_FORGE_API_KEY = "";
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes imports to the mounted volume and returns a subpath-safe URL", async () => {
    const { readLocalStoredFile, storageGetSignedUrl, storagePut } = await import(
      "./storage"
    );

    const stored = await storagePut(
      "1-imports/screenshot.png",
      Buffer.from("image-bytes"),
      "image/png"
    );

    expect(stored.key).toMatch(/^1-imports\/screenshot_[a-f0-9]{8}\.png$/);
    expect(stored.url).toBe(`/investdash/files/${stored.key}`);
    expect(await readLocalStoredFile(stored.key)).toEqual(Buffer.from("image-bytes"));
    expect(await storageGetSignedUrl(stored.key)).toBe(stored.url);
  });
});
