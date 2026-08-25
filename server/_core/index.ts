import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import {
  syncNewsHandler,
  syncPricesHandler,
  urgentReportHandler,
  weeklyReportHandler,
} from "../scheduled";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerRailwayFileStorage } from "../railwayFileStorage";
import { getUserById } from "../db";
import { verifyToken } from "../services/passcode";
import { startRailwayScheduler } from "../railwayScheduler";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "investdash", version: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
  });
  app.get("/healthz/auth", async (req, res) => {
    const authorization = req.headers.authorization;
    const bearerPresent = authorization?.startsWith("Bearer ") ?? false;
    const token = bearerPresent ? authorization!.slice("Bearer ".length).trim() : "";
    const ownerUserId = token ? await verifyToken(token) : null;
    const user = ownerUserId ? await getUserById(ownerUserId) : null;
    res.json({
      authorizationPresent: Boolean(authorization),
      bearerPresent,
      tokenValid: Boolean(ownerUserId),
      userResolved: Boolean(user),
    });
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerRailwayFileStorage(app);
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  app.post("/api/scheduled/syncPrices", syncPricesHandler);
  app.post("/api/scheduled/syncNews", syncNewsHandler);
  app.post("/api/scheduled/syncNews/:batch", syncNewsHandler);
  app.post("/api/scheduled/weeklyReport", weeklyReportHandler);
  app.post("/api/scheduled/urgentReport", urgentReportHandler);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startRailwayScheduler();
  });
}

startServer().catch(console.error);
