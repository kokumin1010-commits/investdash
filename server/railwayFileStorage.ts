import express, { type Express } from "express";
import path from "node:path";

export function registerRailwayFileStorage(app: Express) {
  const configured = process.env.STORAGE_LOCAL_DIR?.trim();
  if (!configured) return;

  const root = path.resolve(configured);
  app.use(
    "/files",
    express.static(root, {
      dotfiles: "deny",
      fallthrough: false,
      index: false,
      maxAge: "7d",
      immutable: true,
    })
  );
  console.log(`[Storage] Railway volume storage enabled at ${root}`);
}
