import { writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const outputPath = process.argv[2] ?? "railway-data-export.json";
const excludedTables = new Set(["__drizzle_migrations"]);
const connection = await mysql.createConnection(databaseUrl);

const normalizeValue = value => {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) {
    return { __type: "buffer", base64: value.toString("base64") };
  }
  return value;
};

try {
  const [tableRows] = await connection.query(
    "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"
  );
  const tables = {};
  for (const row of tableRows) {
    const tableName = String(Object.values(row)[0]);
    if (excludedTables.has(tableName)) continue;
    const [rows] = await connection.query(
      `SELECT * FROM ${connection.escapeId(tableName)}`
    );
    tables[tableName] = rows;
    console.log(`[export] ${tableName}: ${rows.length}`);
  }

  const payload = {
    format: "investdash-railway-export-v1",
    exportedAt: new Date().toISOString(),
    tables,
  };
  await writeFile(
    outputPath,
    JSON.stringify(payload, (_key, value) => normalizeValue(value), 2),
    { mode: 0o600 }
  );
  console.log(`[export] wrote ${outputPath}`);
} finally {
  await connection.end();
}

process.exit(0);
