import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const connection = await mysql.createConnection(databaseUrl);
try {
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("[Railway] Database migrations are current");
} finally {
  await connection.end();
}

if (process.env.RAILWAY_MIGRATE_ONLY === "true") {
  process.exit(0);
}

await import("../dist/index.js");
