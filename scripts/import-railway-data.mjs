import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const inputPath = process.argv[2] ?? "railway-data-export.json";
const payload = JSON.parse(await readFile(inputPath, "utf8"), (_key, value) => {
  if (value?.__type === "buffer") return Buffer.from(value.base64, "base64");
  return value;
});
if (payload.format !== "investdash-railway-export-v1") {
  throw new Error("Unsupported InvestDash export format");
}

const connection = await mysql.createConnection(databaseUrl);
try {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  const [existingTableRows] = await connection.query("SHOW TABLES");
  const existingTables = new Set(
    existingTableRows.map(row => String(Object.values(row)[0]))
  );

  for (const [tableName, rows] of Object.entries(payload.tables)) {
    if (!existingTables.has(tableName)) {
      console.warn(`[import] skipping missing table ${tableName}`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`[import] ${tableName}: 0`);
      continue;
    }

    const [columnRows] = await connection.query(
      `SHOW COLUMNS FROM ${connection.escapeId(tableName)}`
    );
    const allowedColumns = new Set(columnRows.map(column => column.Field));

    let imported = 0;
    for (const row of rows) {
      const columns = Object.keys(row).filter(column => allowedColumns.has(column));
      if (columns.length === 0) continue;
      const values = columns.map(column => row[column]);
      const columnSql = columns.map(column => connection.escapeId(column)).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const updates = columns
        .map(column => `${connection.escapeId(column)} = VALUES(${connection.escapeId(column)})`)
        .join(", ");
      await connection.query(
        `INSERT INTO ${connection.escapeId(tableName)} (${columnSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
        values
      );
      imported += 1;
    }
    console.log(`[import] ${tableName}: ${imported}`);
  }
} finally {
  await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
  await connection.end();
}

process.exit(0);
