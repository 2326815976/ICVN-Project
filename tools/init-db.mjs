import fs from "fs/promises";
import path from "path";

import mysql from "mysql2/promise";

function getRequiredEnv(name, fallback) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const config = {
    host: getRequiredEnv("MYSQL_HOST", "127.0.0.1"),
    port: Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10),
    user: getRequiredEnv("MYSQL_USER", "root"),
    password: process.env.MYSQL_PASSWORD ?? "",
    database: getRequiredEnv("MYSQL_DATABASE", "icvn_graph"),
  };

  const sqlPath = path.resolve(process.cwd(), "db/mysql/init.sql");
  const rawSql = await fs.readFile(sqlPath, "utf8");

  console.log(`Initializing MySQL schema from ${sqlPath}`);
  console.log(`- host: ${config.host}`);
  console.log(`- port: ${config.port}`);
  console.log(`- user: ${config.user}`);
  console.log(`- database: ${config.database}`);

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: true,
    timezone: "Z",
  });

  try {
    await connection.query(rawSql);

    const [tableRows] = await connection.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ?
        ORDER BY table_name ASC
      `,
      [config.database],
    );

    const tableNames = Array.isArray(tableRows)
      ? tableRows
          .map((row) => row.table_name ?? row.TABLE_NAME ?? row.Table_name)
          .filter(Boolean)
      : [];

    console.log("");
    console.log("Database initialization completed.");
    console.log(`- schema: ${config.database}`);
    console.log(`- tables: ${tableNames.length}`);

    for (const tableName of tableNames) {
      console.log(`  - ${tableName}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Database initialization failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
