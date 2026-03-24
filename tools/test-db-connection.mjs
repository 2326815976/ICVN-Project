import mysql from "mysql2/promise";

function getRequiredEnv(name, fallback) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function maskPassword(password) {
  if (!password) {
    return "(empty)";
  }

  return "*".repeat(Math.min(password.length, 8));
}

async function main() {
  const config = {
    host: getRequiredEnv("MYSQL_HOST", "127.0.0.1"),
    port: Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10),
    user: getRequiredEnv("MYSQL_USER", "root"),
    password: process.env.MYSQL_PASSWORD ?? "",
    database: getRequiredEnv("MYSQL_DATABASE", "icvn_graph"),
  };

  console.log("Testing MySQL connectivity with:");
  console.log(`- host: ${config.host}`);
  console.log(`- port: ${config.port}`);
  console.log(`- user: ${config.user}`);
  console.log(`- password: ${maskPassword(config.password)}`);
  console.log(`- database: ${config.database}`);

  const connection = await mysql.createConnection({
    ...config,
    timezone: "Z",
  });

  try {
    const [pingRows] = await connection.query("SELECT 1 AS ok");
    const [metaRows] = await connection.query(
      `
        SELECT
          DATABASE() AS database_name,
          VERSION() AS mysql_version,
          CURRENT_TIMESTAMP() AS server_time
      `,
    );
    const [tableRows] = await connection.query(
      `
        SELECT COUNT(*) AS table_count
        FROM information_schema.tables
        WHERE table_schema = ?
      `,
      [config.database],
    );

    const ping = Array.isArray(pingRows) ? pingRows[0] : null;
    const meta = Array.isArray(metaRows) ? metaRows[0] : null;
    const tableSummary = Array.isArray(tableRows) ? tableRows[0] : null;

    console.log("");
    console.log("MySQL connection successful.");
    console.log(`- ping: ${ping?.ok ?? "unknown"}`);
    console.log(`- database: ${meta?.database_name ?? config.database}`);
    console.log(`- version: ${meta?.mysql_version ?? "unknown"}`);
    console.log(`- server time: ${meta?.server_time ?? "unknown"}`);
    console.log(`- schema table count: ${tableSummary?.table_count ?? 0}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("MySQL connection failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
