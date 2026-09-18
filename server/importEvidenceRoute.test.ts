import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestUser: vi.fn(),
  getImportJob: vi.fn(),
  readLocalStoredFile: vi.fn(),
  storageGetSignedUrl: vi.fn(),
}));

vi.mock("./_core/context", () => ({
  resolveRequestUser: mocks.resolveRequestUser,
}));
vi.mock("./db", () => ({
  getImportJob: mocks.getImportJob,
}));
vi.mock("./storage", () => ({
  readLocalStoredFile: mocks.readLocalStoredFile,
  storageGetSignedUrl: mocks.storageGetSignedUrl,
}));

import { registerImportEvidenceRoute } from "./importEvidenceRoute";

type Handler = (req: any, res: any) => Promise<void>;

function setupRoute() {
  let handler: Handler | null = null;
  const app = {
    get: vi.fn((_path: string, next: Handler) => {
      handler = next;
    }),
  };
  registerImportEvidenceRoute(app as any);
  return () => handler!;
}

function makeResponse() {
  const result: {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  } = {};
  const response = {
    status(code: number) {
      result.status = code;
      return response;
    },
    send(body: unknown) {
      result.body = body;
      return response;
    },
    set(headers: Record<string, string>) {
      result.headers = headers;
      return response;
    },
  };
  return { response, result };
}

const appliedJob = {
  id: 77,
  userId: 9,
  fileKey: null,
  imageUrl: null,
  status: "APPLIED",
  parsed: {
    evidence: [
      {
        fileName: "cash.webp",
        fileKey: "9-imports/cash_1234abcd.webp",
        imageUrl: "/investdash/files/9-imports/cash_1234abcd.webp",
        digest: "digest",
      },
    ],
  },
  accountSummary: null,
  errorMessage: null,
  appliedCount: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("protected import evidence route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_LOCAL_DIR = "/data/investdash-files";
  });

  it("rejects requests without the current passcode session", async () => {
    const getHandler = setupRoute();
    mocks.resolveRequestUser.mockResolvedValue(null);
    const { response, result } = makeResponse();

    await getHandler()({ params: { jobId: "77", imageIndex: "0" } }, response);

    expect(result.status).toBe(401);
    expect(mocks.getImportJob).not.toHaveBeenCalled();
  });

  it("loads the job with the authenticated user id and returns private image bytes", async () => {
    const getHandler = setupRoute();
    mocks.resolveRequestUser.mockResolvedValue({ id: 9 });
    mocks.getImportJob.mockResolvedValue(appliedJob);
    mocks.readLocalStoredFile.mockResolvedValue(Buffer.from("image-bytes"));
    const { response, result } = makeResponse();

    await getHandler()({ params: { jobId: "77", imageIndex: "0" } }, response);

    expect(mocks.getImportJob).toHaveBeenCalledWith(9, 77);
    expect(mocks.readLocalStoredFile).toHaveBeenCalledWith(
      "9-imports/cash_1234abcd.webp"
    );
    expect(result.status).toBeUndefined();
    expect(result.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=300",
      })
    );
    expect(result.body).toEqual(Buffer.from("image-bytes"));
  });

  it("does not serve a storage key outside the authenticated user's import prefix", async () => {
    const getHandler = setupRoute();
    mocks.resolveRequestUser.mockResolvedValue({ id: 10 });
    mocks.getImportJob.mockResolvedValue(appliedJob);
    const { response, result } = makeResponse();

    await getHandler()({ params: { jobId: "77", imageIndex: "0" } }, response);

    expect(result.status).toBe(404);
    expect(mocks.readLocalStoredFile).not.toHaveBeenCalled();
  });
});
