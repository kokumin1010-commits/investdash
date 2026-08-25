import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const expected = {
  users: 1,
  holdings: 156,
  watchlist: 11,
  monthlyHoldings: 156,
  monthlySnapshots: 1,
  newsItems: 14,
  passcodeAuth: 1,
  portfolioSnapshots: 7,
  interestAssets: 4,
  brokerBalances: 1,
};

const connection = await mysql.createConnection(databaseUrl);
let failed = false;
try {
  for (const [tableName, expectedCount] of Object.entries(expected)) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${connection.escapeId(tableName)}`
    );
    const actualCount = Number(rows[0]?.count ?? 0);
    const matches = actualCount === expectedCount;
    failed ||= !matches;
    console.log(
      `[verify] ${tableName}: ${actualCount} ${matches ? "OK" : `(expected ${expectedCount})`}`
    );
  }
} finally {
  await connection.end();
}

process.exit(failed ? 1 : 0);
