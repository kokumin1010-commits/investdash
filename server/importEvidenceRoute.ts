import type { Express } from "express";
import path from "node:path";
import { resolveRequestUser } from "./_core/context";
import * as db from "./db";
import { getImportEvidenceAt } from "./services/importHistory";
import { readLocalStoredFile, storageGetSignedUrl } from "./storage";

function contentTypeForKey(key: string): string {
  switch (path.extname(key).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

/**
 * <img> へ直接公開URLを渡さず、Authorization付きfetch経由で原画像を返す。
 * job検索とstorage key prefixの両方でユーザーを分離する。
 */
export function registerImportEvidenceRoute(app: Express) {
  app.get("/api/import-evidence/:jobId/:imageIndex", async (req, res) => {
    try {
      const user = await resolveRequestUser(req);
      if (!user) {
        res.status(401).send("Unauthorized");
        return;
      }

      const jobId = Number(req.params.jobId);
      const imageIndex = Number(req.params.imageIndex);
      if (
        !Number.isSafeInteger(jobId) ||
        jobId <= 0 ||
        !Number.isSafeInteger(imageIndex) ||
        imageIndex < 0
      ) {
        res.status(400).send("Invalid evidence reference");
        return;
      }

      const job = await db.getImportJob(user.id, jobId);
      if (!job) {
        res.status(404).send("Evidence not found");
        return;
      }
      const evidence = getImportEvidenceAt(job, imageIndex);
      const key = evidence?.fileKey;
      if (!key || !key.startsWith(`${user.id}-imports/`)) {
        res.status(404).send("Evidence not found");
        return;
      }

      let bytes: Buffer;
      let contentType = contentTypeForKey(key);
      if (process.env.STORAGE_LOCAL_DIR?.trim()) {
        bytes = await readLocalStoredFile(key);
      } else {
        const signedUrl = await storageGetSignedUrl(key);
        const response = await fetch(signedUrl);
        if (!response.ok) {
          res.status(502).send("Evidence storage unavailable");
          return;
        }
        const upstreamType = response.headers.get("content-type");
        if (upstreamType?.startsWith("image/")) contentType = upstreamType;
        bytes = Buffer.from(await response.arrayBuffer());
      }

      res.set({
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      });
      res.send(bytes);
    } catch (error) {
      console.error("[ImportEvidence] failed:", error);
      res.status(500).send("Evidence unavailable");
    }
  });
}
