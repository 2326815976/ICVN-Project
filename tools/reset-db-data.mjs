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

async function deleteTableRows(connection, tableName) {
  const [result] = await connection.query(`DELETE FROM \`${tableName}\``);
  const affectedRows =
    result && typeof result === "object" && "affectedRows" in result && typeof result.affectedRows === "number"
      ? result.affectedRows
      : 0;

  console.log(`- cleared ${tableName}: ${affectedRows} rows`);
}

async function listExistingTables(connection, database) {
  const [rows] = await connection.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_name ASC
    `,
    [database],
  );

  return new Set(
    Array.isArray(rows)
      ? rows
          .map((row) => row.table_name ?? row.TABLE_NAME ?? row.Table_name)
          .filter((value) => typeof value === "string" && value.length > 0)
      : [],
  );
}

async function main() {
  const config = {
    host: getRequiredEnv("MYSQL_HOST", "127.0.0.1"),
    port: Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10),
    user: getRequiredEnv("MYSQL_USER", "root"),
    password: process.env.MYSQL_PASSWORD ?? "",
    database: getRequiredEnv("MYSQL_DATABASE", "icvn_graph"),
    timezone: process.env.MYSQL_TIMEZONE ?? "local",
  };
  const defaultGraphId = process.env.DEFAULT_GRAPH_ID ?? "default";
  const defaultActorId = process.env.DEFAULT_ACTOR_ID ?? "system";

  console.log("Resetting MySQL data with:");
  console.log(`- host: ${config.host}`);
  console.log(`- port: ${config.port}`);
  console.log(`- user: ${config.user}`);
  console.log(`- password: ${maskPassword(config.password)}`);
  console.log(`- database: ${config.database}`);
  console.log(`- timezone: ${config.timezone}`);
  console.log(`- default graph id: ${defaultGraphId}`);
  console.log(`- default actor id: ${defaultActorId}`);

  const connection = await mysql.createConnection({
    ...config,
  });

  const tableDeletionOrder = [
    "graph_change_history",
    "evidence_records",
    "entity_source_links",
    "source_records",
    "graph_versions",
    "graph_snapshots",
    "task_events",
    "task_results",
    "task_files",
    "tasks",
    "graph_edges",
    "graph_nodes",
    "graphs",
  ];

  try {
    await connection.beginTransaction();
    const existingTables = await listExistingTables(connection, config.database);

    console.log("");
    console.log("Clearing table data...");

    for (const tableName of tableDeletionOrder) {
      if (!existingTables.has(tableName)) {
        console.log(`- skipped ${tableName}: table not found`);
        continue;
      }

      await deleteTableRows(connection, tableName);
    }

    const [insertResult] = await connection.execute(
      `
        INSERT INTO graphs (id, name, description, status, created_by)
        VALUES (?, ?, ?, 'active', ?)
      `,
      [
        defaultGraphId,
        defaultGraphId === "default" ? "Default Graph" : `Graph ${defaultGraphId}`,
        "系统默认图谱",
        defaultActorId,
      ],
    );

    const insertedDefaultGraph =
      insertResult &&
      typeof insertResult === "object" &&
      "affectedRows" in insertResult &&
      typeof insertResult.affectedRows === "number" &&
      insertResult.affectedRows > 0;

    console.log("");
    console.log(`- restored default graph: ${insertedDefaultGraph ? "yes" : "no"}`);

    const [graphRows] = await connection.query(
      `
        SELECT id, name, status, created_by
        FROM graphs
        ORDER BY id ASC
      `,
    );

    if (Array.isArray(graphRows)) {
      for (const row of graphRows) {
        console.log(`  - graph ${row.id} (${row.name}) status=${row.status} created_by=${row.created_by}`);
      }
    }

    await connection.commit();

    console.log("");
    console.log("Database data reset completed.");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Database data reset failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
