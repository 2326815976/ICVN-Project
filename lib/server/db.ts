import mysql, { type Pool, type PoolConnection } from "mysql2/promise";

declare global {
  var __icvnMysqlPool: Pool | undefined;
  var __icvnMysqlPoolConfigKey: string | undefined;
}

function getRequiredEnv(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getMysqlPool() {
  const mysqlTimezone = process.env.MYSQL_TIMEZONE ?? "local";
  const connectionConfig = {
    host: getRequiredEnv("MYSQL_HOST", "127.0.0.1"),
    port: Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10),
    user: getRequiredEnv("MYSQL_USER", "root"),
    password: process.env.MYSQL_PASSWORD ?? "",
    database: getRequiredEnv("MYSQL_DATABASE", "icvn_graph"),
    connectionLimit: 10,
    timezone: mysqlTimezone,
    namedPlaceholders: true,
    decimalNumbers: true,
  } as const;
  const nextConfigKey = JSON.stringify({
    host: connectionConfig.host,
    port: connectionConfig.port,
    user: connectionConfig.user,
    database: connectionConfig.database,
    timezone: connectionConfig.timezone,
  });

  if (!globalThis.__icvnMysqlPool || globalThis.__icvnMysqlPoolConfigKey !== nextConfigKey) {
    if (globalThis.__icvnMysqlPool) {
      void globalThis.__icvnMysqlPool.end().catch(() => undefined);
    }

    globalThis.__icvnMysqlPool = mysql.createPool(connectionConfig);
    globalThis.__icvnMysqlPoolConfigKey = nextConfigKey;
  }

  return globalThis.__icvnMysqlPool;
}

export async function withConnection<T>(executor: (connection: PoolConnection) => Promise<T>) {
  const connection = await getMysqlPool().getConnection();

  try {
    return await executor(connection);
  } finally {
    connection.release();
  }
}

export async function withTransaction<T>(executor: (connection: PoolConnection) => Promise<T>) {
  return withConnection(async (connection) => {
    await connection.beginTransaction();

    try {
      const result = await executor(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}
