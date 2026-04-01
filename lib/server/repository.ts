import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

import type {
  AiParseRequest,
  AiParseResult,
  AiRawParseResponse,
  ChangeHistoryItem,
  CreateEdgeRequest,
  CreateNodeRequest,
  CreateTaskRequest,
  EdgeDetailResponse,
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  GraphView,
  JsonValue,
  NodeDetailResponse,
  NodeHistoryResponse,
  NodeSearchResponse,
  NodeSourcesResponse,
  RelationsResponse,
  SaveTaskResultRequest,
  SourceCreateRequest,
  SourceRecord,
  SubgraphQueryRequest,
  SubgraphResponse,
  Task,
  TaskApplyResponse,
  TaskDeleteResponse,
  TaskEvent,
  TaskEventListResponse,
  TaskFile,
  TaskListResponse,
  TaskParseResponse,
  TaskResultResponse,
  TaskSummary,
  UpdateTaskRequest,
  UpdateEdgeRequest,
  UpdateNodeRequest,
} from "@/lib/domain/models";
import { ApiError, getDefaultActorId, getDefaultGraphId } from "@/lib/server/api";
import { createSubgraph } from "@/lib/server/graph-queries";
import { withConnection, withTransaction } from "@/lib/server/db";
import {
  buildGraphResultFromRawAiParseResponse,
  coerceRecord,
  coerceStringArray,
  createId,
  fromJsonValue,
  nowIso,
  paginate,
  toJsonString,
  truncateText,
} from "@/lib/server/utils";

type DbRow = RowDataPacket & Record<string, unknown>;

declare global {
  // In local deployment we keep one in-memory registry to avoid scheduling the same parse twice.
  var __icvnActiveTaskParsers: Set<string> | undefined;
}

function getInternalApiBaseUrl() {
  const configuredBaseUrl =
    process.env.INTERNAL_API_BASE_URL ??
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_BASE_URL ??
    "http://127.0.0.1:8000";

  return configuredBaseUrl.replace(/\/+$/, "");
}

function getActiveTaskParsers() {
  if (!globalThis.__icvnActiveTaskParsers) {
    globalThis.__icvnActiveTaskParsers = new Set<string>();
  }

  return globalThis.__icvnActiveTaskParsers;
}

async function postJsonWithoutHeadersTimeout(url: string, body: unknown) {
  const targetUrl = new URL(url);
  const requestBody = JSON.stringify(body);
  const transport = targetUrl.protocol === "https:" ? https : http;

  return await new Promise<{
    statusCode: number;
    payload: unknown;
  }>((resolve, reject) => {
    const request = transport.request(
      targetUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(requestBody),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          const rawText = Buffer.concat(chunks).toString("utf8");

          if (!rawText.trim()) {
            resolve({
              statusCode: response.statusCode ?? 0,
              payload: null,
            });
            return;
          }

          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              payload: JSON.parse(rawText),
            });
          } catch {
            reject(new ApiError(502, "AI_PARSE_INVALID_RESPONSE", "AI parse upstream returned non-JSON payload"));
          }
        });
      },
    );

    request.on("error", (error) => {
      reject(error);
    });

    request.setTimeout(0);
    request.write(requestBody);
    request.end();
  });
}

function coerceAiRawParseResponse(payload: unknown, taskId: string): AiRawParseResponse {
  const root = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const wrappedData =
    typeof root.data === "object" && root.data !== null ? (root.data as Record<string, unknown>) : root;
  const result =
    typeof wrappedData.result === "object" && wrappedData.result !== null
      ? (wrappedData.result as AiRawParseResponse["result"])
      : null;

  if (!result) {
    throw new ApiError(502, "AI_PARSE_INVALID_RESPONSE", "AI parse upstream returned invalid payload");
  }

  return {
    taskId: typeof wrappedData.taskId === "string" && wrappedData.taskId.trim() ? wrappedData.taskId : taskId,
    projectId: typeof wrappedData.projectId === "string" ? wrappedData.projectId : undefined,
    type: typeof wrappedData.type === "string" && wrappedData.type.trim() ? wrappedData.type : "merge",
    result,
    errorMessage: typeof wrappedData.errorMessage === "string" ? wrappedData.errorMessage : null,
    createdAt:
      typeof wrappedData.createdAt === "string" && wrappedData.createdAt.trim()
        ? wrappedData.createdAt
        : nowIso(),
    updatedAt:
      typeof wrappedData.updatedAt === "string" && wrappedData.updatedAt.trim()
        ? wrappedData.updatedAt
        : nowIso(),
  };
}

async function requestAiParseViaHttp(params: {
  taskId: string;
  title: string;
  input: AiParseRequest;
}) {
  const requestBody = {
    taskId: params.taskId,
    content: params.input.content,
  } satisfies AiParseRequest;

  console.log("[ai-parse] upstream request content", {
    taskId: params.taskId,
    title: params.title,
    content: requestBody.content,
  });

  let result: { statusCode: number; payload: unknown };
  try {
    result = await postJsonWithoutHeadersTimeout(`${getInternalApiBaseUrl()}/api/ai/parse`, requestBody);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    const message =
      error instanceof Error
        ? `AI parse upstream request failed: ${error.message}`
        : "AI parse upstream request failed";

    throw new ApiError(502, "AI_PARSE_UPSTREAM_ERROR", message, {
      taskId: params.taskId,
      baseUrl: getInternalApiBaseUrl(),
    });
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const upstreamMessage =
      typeof result.payload === "object" &&
      result.payload !== null &&
      typeof (result.payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (result.payload as { error: { message: string } }).error.message
        : `AI parse upstream HTTP ${result.statusCode}`;
    throw new ApiError(502, "AI_PARSE_UPSTREAM_ERROR", upstreamMessage, {
      taskId: params.taskId,
      baseUrl: getInternalApiBaseUrl(),
    });
  }

  return coerceAiRawParseResponse(result.payload, params.taskId);
}

async function finalizeTaskParseSuccess(params: {
  taskId: string;
  graphId: string;
  sourceType: Task["sourceType"];
  rawResult: AiRawParseResponse;
}) {
  const result = buildGraphResultFromRawAiParseResponse({
    graphId: params.graphId,
    taskId: params.taskId,
    sourceType: params.sourceType,
    rawResult: params.rawResult,
  });

  await withTransaction(async (connection) => {
    await connection.execute(
      `
        INSERT INTO task_results (
          id, task_id, raw_result, normalized_result, node_count, edge_count, event_count
        )
        VALUES (
          :id, :taskId, :rawResult, :normalizedResult, :nodeCount, :edgeCount, :eventCount
        )
        ON DUPLICATE KEY UPDATE
          raw_result = VALUES(raw_result),
          normalized_result = VALUES(normalized_result),
          node_count = VALUES(node_count),
          edge_count = VALUES(edge_count),
          event_count = VALUES(event_count),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      {
        id: createId("trs"),
        taskId: params.taskId,
        rawResult: toJsonString(params.rawResult),
        normalizedResult: toJsonString(result),
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        eventCount: result.events.length,
      },
    );

    await connection.execute(
      `
        UPDATE tasks
        SET
          status = 'validated',
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :taskId
      `,
      {
        taskId: params.taskId,
      },
    );

    await appendTaskEvents(connection, params.taskId, [
      {
        type: "validated",
        message: "AI 原始结果与图谱结构化结果已生成。",
        payload: { status: "validated" },
      },
    ]);
  });
}

async function finalizeTaskParseFailure(taskId: string, error: unknown) {
  await withTransaction(async (connection) => {
    const taskRow = await getTaskRow(connection, taskId);
    if (!taskRow || String(taskRow.status) === "applied") {
      return;
    }

    const errorMessage = truncateText(error instanceof Error ? error.message : "Task parse failed", 500);

    await connection.execute(
      `
        UPDATE tasks
        SET
          status = 'failed',
          error_message = :errorMessage,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :taskId
      `,
      {
        taskId,
        errorMessage,
      },
    );

    await appendTaskEvents(connection, taskId, [
      {
        type: "failed",
        message: "任务处理失败。",
        payload: { status: "failed", error: errorMessage },
      },
    ]);
  });
}

async function runTaskParseInBackground(params: {
  taskId: string;
  graphId: string;
  title: string;
  sourceType: Task["sourceType"];
  content: string[];
}) {
  const activeParsers = getActiveTaskParsers();
  if (activeParsers.has(params.taskId)) {
    return;
  }

  activeParsers.add(params.taskId);

  try {
    const rawResult = await requestAiParseViaHttp({
      taskId: params.taskId,
      title: params.title,
      input: {
        taskId: params.taskId,
        content: params.content,
      },
    });

    await finalizeTaskParseSuccess({
      taskId: params.taskId,
      graphId: params.graphId,
      sourceType: params.sourceType,
      rawResult,
    });
  } catch (error) {
    await finalizeTaskParseFailure(params.taskId, error);
  } finally {
    activeParsers.delete(params.taskId);
  }
}

function asIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value.includes("T") ? value : new Date(value).toISOString();
  }

  return new Date(String(value ?? Date.now())).toISOString();
}

function asDateOnly(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function mapGraphNode(row: DbRow): GraphNode {
  const positionX = typeof row.position_x === "number" ? row.position_x : null;
  const positionY = typeof row.position_y === "number" ? row.position_y : null;

  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    type: String(row.type),
    label: String(row.label),
    properties: coerceRecord(row.properties),
    position:
      positionX !== null && positionY !== null
        ? {
            x: positionX,
            y: positionY,
          }
        : undefined,
    occurredAt: asDateOnly(row.occurred_at),
    periodStart: asDateOnly(row.period_start),
    periodEnd: asDateOnly(row.period_end),
    placeId: row.place_id ? String(row.place_id) : null,
    participants: coerceStringArray(row.participants),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

function mapGraphEdge(row: DbRow): GraphEdge {
  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    sourceId: String(row.source_id),
    targetId: String(row.target_id),
    relation: String(row.relation),
    label: row.label ? String(row.label) : null,
    start: asDateOnly(row.start_date),
    end: asDateOnly(row.end_date),
    weight: typeof row.weight === "number" ? row.weight : null,
    properties: coerceRecord(row.properties),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

function mapSourceRecord(row: DbRow): SourceRecord {
  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    sourceType: row.source_type as SourceRecord["sourceType"],
    sourceRefId: row.source_ref_id ? String(row.source_ref_id) : null,
    title: String(row.title),
    content: row.content ? String(row.content) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: asIsoString(row.created_at),
  };
}

function mapEvidenceRecord(row: DbRow): EvidenceRecord {
  return {
    id: String(row.id),
    sourceRecordId: String(row.source_record_id),
    subjectNodeId: String(row.subject_node_id),
    targetNodeId: row.target_node_id ? String(row.target_node_id) : null,
    edgeId: row.edge_id ? String(row.edge_id) : null,
    relation: row.relation ? String(row.relation) : null,
    excerpt: String(row.excerpt),
    speaker: row.speaker ? String(row.speaker) : null,
    pageNo: typeof row.page_no === "number" ? row.page_no : null,
    createdAt: asIsoString(row.created_at),
  };
}

function mapChangeHistoryItem(row: DbRow): ChangeHistoryItem {
  return {
    id: String(row.id),
    entityType: row.entity_type as ChangeHistoryItem["entityType"],
    entityId: String(row.entity_id),
    action: row.action as ChangeHistoryItem["action"],
    field: row.field_name ? String(row.field_name) : null,
    oldValue: fromJsonValue<JsonValue | undefined>(row.old_value, undefined),
    newValue: fromJsonValue<JsonValue | undefined>(row.new_value, undefined),
    operatorId: String(row.operator_id),
    createdAt: asIsoString(row.created_at),
  };
}

function mapTaskFile(row: DbRow): TaskFile {
  return {
    fileId: String(row.id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    size: typeof row.file_size === "number" ? row.file_size : undefined,
    storageKey: row.storage_key ? String(row.storage_key) : undefined,
  };
}

function buildTaskSummary(row: DbRow): TaskSummary | undefined {
  if (
    typeof row.node_count !== "number" &&
    typeof row.edge_count !== "number" &&
    typeof row.event_count !== "number"
  ) {
    return undefined;
  }

  return {
    nodeCount: Number(row.node_count ?? 0),
    edgeCount: Number(row.edge_count ?? 0),
    eventCount: Number(row.event_count ?? 0),
  };
}

function mapTask(row: DbRow, files: TaskFile[]): Task {
  return {
    id: String(row.id),
    sourceType: row.source_type as Task["sourceType"],
    title: String(row.title),
    status: row.status as Task["status"],
    files,
    summary: buildTaskSummary(row),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdBy: String(row.created_by),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

function mapTaskEvent(row: DbRow): TaskEvent {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    type: String(row.event_type),
    message: String(row.message),
    payload: fromJsonValue<Record<string, JsonValue>>(row.payload, {}),
    createdAt: asIsoString(row.created_at),
  };
}

async function ensureGraph(connection: PoolConnection, graphId: string) {
  await connection.execute(
    `
      INSERT INTO graphs (id, name, description, status, created_by)
      VALUES (:graphId, :name, :description, 'active', :createdBy)
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)
    `,
    {
      graphId,
      name: graphId === "default" ? "Default Graph" : `Graph ${graphId}`,
      description: "Auto-created by API request",
      createdBy: getDefaultActorId(),
    },
  );
}

async function findNode(connection: PoolConnection, id: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_nodes WHERE id = :id LIMIT 1",
    { id },
  );

  return rows[0] ? mapGraphNode(rows[0]) : null;
}

async function findEdge(connection: PoolConnection, id: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_edges WHERE id = :id LIMIT 1",
    { id },
  );

  return rows[0] ? mapGraphEdge(rows[0]) : null;
}

async function getTaskRow(connection: PoolConnection, taskId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    `
      SELECT
        t.*,
        tr.node_count,
        tr.edge_count,
        tr.event_count
      FROM tasks t
      LEFT JOIN task_results tr ON tr.task_id = t.id
      WHERE t.id = :taskId
      LIMIT 1
    `,
    { taskId },
  );

  return rows[0] ?? null;
}

async function getTaskFiles(connection: PoolConnection, taskId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM task_files WHERE task_id = :taskId ORDER BY created_at ASC",
    { taskId },
  );

  return rows.map(mapTaskFile);
}

async function getTaskOrThrow(connection: PoolConnection, taskId: string) {
  const taskRow = await getTaskRow(connection, taskId);

  if (!taskRow) {
    throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
  }

  return mapTask(taskRow, await getTaskFiles(connection, taskId));
}

async function getTaskResultRecord(connection: PoolConnection, taskId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM task_results WHERE task_id = :taskId LIMIT 1",
    { taskId },
  );

  return rows[0] ?? null;
}

async function appendTaskEvents(
  connection: PoolConnection,
  taskId: string,
  events: Array<{
    type: string;
    message: string;
    payload?: Record<string, JsonValue>;
  }>,
) {
  if (events.length === 0) {
    return;
  }

  const [seqRows] = await connection.execute<DbRow[]>(
    "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM task_events WHERE task_id = :taskId",
    { taskId },
  );

  let nextSeq = Number(seqRows[0]?.max_seq ?? 0);

  for (const event of events) {
    nextSeq += 1;
    await connection.execute(
      `
        INSERT INTO task_events (id, task_id, seq, event_type, message, payload)
        VALUES (:id, :taskId, :seq, :eventType, :message, :payload)
      `,
      {
        id: createId("evt"),
        taskId,
        seq: nextSeq,
        eventType: event.type,
        message: event.message,
        payload: toJsonString(event.payload ?? {}),
      },
    );
  }
}

async function loadGraphNodes(connection: PoolConnection, graphId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_nodes WHERE graph_id = :graphId ORDER BY created_at ASC",
    { graphId },
  );

  return rows.map(mapGraphNode);
}

async function loadGraphEdges(connection: PoolConnection, graphId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_edges WHERE graph_id = :graphId ORDER BY created_at ASC",
    { graphId },
  );

  return rows.map(mapGraphEdge);
}

async function createSourceRecord(
  connection: PoolConnection,
  graphId: string,
  source: SourceCreateRequest,
  createdBy = getDefaultActorId(),
) {
  const sourceId = createId("src");
  await connection.execute(
    `
      INSERT INTO source_records (
        id, graph_id, source_type, source_ref_id, title, content, created_by
      )
      VALUES (
        :id, :graphId, :sourceType, :sourceRefId, :title, :content, :createdBy
      )
    `,
    {
      id: sourceId,
      graphId,
      sourceType: source.sourceType,
      sourceRefId: source.sourceRefId ?? null,
      title: source.title,
      content: source.content ?? null,
      createdBy,
    },
  );

  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM source_records WHERE id = :id LIMIT 1",
    { id: sourceId },
  );

  return rows[0] ? mapSourceRecord(rows[0]) : null;
}

async function linkEntitySource(
  connection: PoolConnection,
  params: {
    graphId: string;
    entityType: "node" | "edge";
    entityId: string;
    sourceRecordId: string;
  },
) {
  await connection.execute(
    `
      INSERT INTO entity_source_links (id, graph_id, entity_type, entity_id, source_record_id)
      VALUES (:id, :graphId, :entityType, :entityId, :sourceRecordId)
    `,
    {
      id: createId("esl"),
      ...params,
    },
  );
}

async function createEvidence(
  connection: PoolConnection,
  params: {
    graphId: string;
    sourceRecordId: string;
    subjectNodeId: string;
    targetNodeId?: string | null;
    edgeId?: string | null;
    relation?: string | null;
    excerpt: string;
    speaker?: string | null;
    pageNo?: number | null;
  },
) {
  await connection.execute(
    `
      INSERT INTO evidence_records (
        id, graph_id, source_record_id, subject_node_id, target_node_id, edge_id, relation, excerpt, speaker, page_no
      )
      VALUES (
        :id, :graphId, :sourceRecordId, :subjectNodeId, :targetNodeId, :edgeId, :relation, :excerpt, :speaker, :pageNo
      )
    `,
    {
      id: createId("evd"),
      graphId: params.graphId,
      sourceRecordId: params.sourceRecordId,
      subjectNodeId: params.subjectNodeId,
      targetNodeId: params.targetNodeId ?? null,
      edgeId: params.edgeId ?? null,
      relation: params.relation ?? null,
      excerpt: params.excerpt,
      speaker: params.speaker ?? null,
      pageNo: params.pageNo ?? null,
    },
  );
}

async function recordChangeHistory(
  connection: PoolConnection,
  params: {
    graphId: string;
    entityType: "node" | "edge";
    entityId: string;
    action: "create" | "update" | "delete";
    fieldName?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    sourceRecordId?: string | null;
    operatorId?: string;
  },
) {
  await connection.execute(
    `
      INSERT INTO graph_change_history (
        id, graph_id, entity_type, entity_id, action, field_name, old_value, new_value, operator_id, source_record_id
      )
      VALUES (
        :id, :graphId, :entityType, :entityId, :action, :fieldName, :oldValue, :newValue, :operatorId, :sourceRecordId
      )
    `,
    {
      id: createId("chg"),
      graphId: params.graphId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      fieldName: params.fieldName ?? null,
      oldValue: params.oldValue === undefined ? null : toJsonString(params.oldValue),
      newValue: params.newValue === undefined ? null : toJsonString(params.newValue),
      operatorId: params.operatorId ?? getDefaultActorId(),
      sourceRecordId: params.sourceRecordId ?? null,
    },
  );
}

export async function parseTaskContent(taskId: string, input: AiParseRequest) {
  const contents = input.content.map((item) => item.trim()).filter((item) => item.length > 0);

  if (contents.length === 0) {
    throw new ApiError(400, "BAD_REQUEST", "content is required");
  }

  const scheduled = await withTransaction(async (connection) => {
    const taskRow = await getTaskRow(connection, taskId);

    if (!taskRow) {
      throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
    }

    if (String(taskRow.status) === "applied") {
      throw new ApiError(409, "TASK_NOT_PARSABLE", "Applied task cannot be parsed again");
    }

    if (String(taskRow.status) === "processing" || String(taskRow.status) === "queued") {
      return {
        taskId,
        status: String(taskRow.status) as TaskParseResponse["status"],
        shouldSchedule: false,
      };
    }

    const graphId = String(taskRow.graph_id ?? getDefaultGraphId());
    const mergedContent = contents.join("\n\n");
    const contentPreview = truncateText(mergedContent, 200);

    await ensureGraph(connection, graphId);
    await connection.execute(
      `
        UPDATE tasks
        SET
          input_text = :inputText,
          content_preview = :contentPreview,
          status = 'processing',
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :taskId
      `,
      {
        taskId,
        inputText: mergedContent,
        contentPreview,
      },
    );

    await appendTaskEvents(connection, taskId, [
      {
        type: "queued",
        message: "任务内容已接收，已进入 AI 解析队列。",
        payload: { status: "queued" },
      },
      {
        type: "processing",
        message: "AI 原始结果正在生成。",
        payload: { status: "processing" },
      },
    ]);

    return {
      taskId,
      status: "processing" as const,
      shouldSchedule: true,
      graphId,
      title: String(taskRow.title),
      sourceType: taskRow.source_type as Task["sourceType"],
    };
  });

  if (!scheduled.shouldSchedule) {
    return {
      taskId,
      status: scheduled.status,
    } satisfies TaskParseResponse;
  }

  void runTaskParseInBackground({
    taskId,
    graphId: scheduled.graphId!,
    title: scheduled.title!,
    sourceType: scheduled.sourceType!,
    content: contents,
  });

  return {
    taskId,
    status: scheduled.status,
  } satisfies TaskParseResponse;
}

async function applyResultToGraph(
  connection: PoolConnection,
  params: {
    taskId: string;
    title: string;
    graphId: string;
    contentPreview?: string;
    result: AiParseResult;
  },
) {
  await ensureGraph(connection, params.graphId);

  for (const node of [...params.result.nodes, ...params.result.events].map((item) => ({
    ...item,
    graphId: params.graphId,
  }))) {
    await upsertNode(connection, node);
    await recordChangeHistory(connection, {
      graphId: params.graphId,
      entityType: "node",
      entityId: node.id,
      action: "create",
      newValue: node,
    });
  }

  for (const edge of params.result.edges.map((item) => ({ ...item, graphId: params.graphId }))) {
    await upsertEdge(connection, edge);
    await recordChangeHistory(connection, {
      graphId: params.graphId,
      entityType: "edge",
      entityId: edge.id,
      action: "create",
      newValue: edge,
    });
  }

  const source = await createSourceRecord(connection, params.graphId, {
    sourceType: "task",
    sourceRefId: params.taskId,
    title: params.title,
    content: params.contentPreview ?? params.result.meta.summary ?? params.title,
  });

  if (source) {
    for (const node of [...params.result.nodes, ...params.result.events]) {
      await linkEntitySource(connection, {
        graphId: params.graphId,
        entityType: "node",
        entityId: node.id,
        sourceRecordId: source.id,
      });
    }

    for (const edge of params.result.edges) {
      await linkEntitySource(connection, {
        graphId: params.graphId,
        entityType: "edge",
        entityId: edge.id,
        sourceRecordId: source.id,
      });

      await createEvidence(connection, {
        graphId: params.graphId,
        sourceRecordId: source.id,
        subjectNodeId: edge.sourceId,
        targetNodeId: edge.targetId,
        edgeId: edge.id,
        relation: edge.relation,
        excerpt: params.result.meta.summary ?? params.contentPreview ?? `${params.title} 的结构化关系`,
      });
    }
  }

  await connection.execute(
    `
      UPDATE tasks
      SET
        status = 'applied',
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :taskId
    `,
    {
      taskId: params.taskId,
    },
  );

  await appendTaskEvents(connection, params.taskId, [
    { type: "applied", message: "任务结果已入图。", payload: { status: "applied" } },
  ]);

  return {
    taskId: params.taskId,
    status: "applied",
  } satisfies TaskApplyResponse;
}

async function upsertNode(connection: PoolConnection, node: GraphNode) {
  await connection.execute(
    `
      INSERT INTO graph_nodes (
        id, graph_id, type, label, properties, position_x, position_y,
        occurred_at, period_start, period_end, place_id, participants
      )
      VALUES (
        :id, :graphId, :type, :label, :properties, :positionX, :positionY,
        :occurredAt, :periodStart, :periodEnd, :placeId, :participants
      )
      ON DUPLICATE KEY UPDATE
        graph_id = VALUES(graph_id),
        type = VALUES(type),
        label = VALUES(label),
        properties = VALUES(properties),
        position_x = VALUES(position_x),
        position_y = VALUES(position_y),
        occurred_at = VALUES(occurred_at),
        period_start = VALUES(period_start),
        period_end = VALUES(period_end),
        place_id = VALUES(place_id),
        participants = VALUES(participants),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    {
      id: node.id,
      graphId: node.graphId,
      type: node.type,
      label: node.label,
      properties: toJsonString(node.properties),
      positionX: node.position?.x ?? null,
      positionY: node.position?.y ?? null,
      occurredAt: node.occurredAt ?? null,
      periodStart: node.periodStart ?? null,
      periodEnd: node.periodEnd ?? null,
      placeId: node.placeId ?? null,
      participants: toJsonString(node.participants ?? []),
    },
  );
}

async function upsertEdge(connection: PoolConnection, edge: GraphEdge) {
  await connection.execute(
    `
      INSERT INTO graph_edges (
        id, graph_id, source_id, target_id, relation, label,
        start_date, end_date, weight, properties
      )
      VALUES (
        :id, :graphId, :sourceId, :targetId, :relation, :label,
        :startDate, :endDate, :weight, :properties
      )
      ON DUPLICATE KEY UPDATE
        graph_id = VALUES(graph_id),
        source_id = VALUES(source_id),
        target_id = VALUES(target_id),
        relation = VALUES(relation),
        label = VALUES(label),
        start_date = VALUES(start_date),
        end_date = VALUES(end_date),
        weight = VALUES(weight),
        properties = VALUES(properties),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    {
      id: edge.id,
      graphId: edge.graphId,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relation: edge.relation,
      label: edge.label ?? null,
      startDate: edge.start ?? null,
      endDate: edge.end ?? null,
      weight: edge.weight ?? null,
      properties: toJsonString(edge.properties),
    },
  );
}

async function deleteEdgesAndAssociations(connection: PoolConnection, edgeIds: string[]) {
  if (edgeIds.length === 0) {
    return;
  }

  await connection.execute(
    `DELETE FROM entity_source_links WHERE entity_type = 'edge' AND entity_id IN (${edgeIds.map(() => "?").join(", ")})`,
    edgeIds,
  );
  await connection.execute(
    `DELETE FROM evidence_records WHERE edge_id IN (${edgeIds.map(() => "?").join(", ")})`,
    edgeIds,
  );
  await connection.execute(
    `DELETE FROM graph_edges WHERE id IN (${edgeIds.map(() => "?").join(", ")})`,
    edgeIds,
  );
}

async function cleanupNodeAssociations(connection: PoolConnection, nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return;
  }

  await connection.execute(
    `DELETE FROM entity_source_links WHERE entity_type = 'node' AND entity_id IN (${nodeIds.map(() => "?").join(", ")})`,
    nodeIds,
  );
  await connection.execute(
    `
      DELETE FROM evidence_records
      WHERE subject_node_id IN (${nodeIds.map(() => "?").join(", ")})
      OR target_node_id IN (${nodeIds.map(() => "?").join(", ")})
    `,
    [...nodeIds, ...nodeIds],
  );
}

export async function createTask(input: CreateTaskRequest) {
  return withTransaction(async (connection) => {
    const graphId = getDefaultGraphId();
    await ensureGraph(connection, graphId);

    const taskId = createId("task");
    const contentPreview = truncateText(
      input.content?.trim() ||
        input.files?.map((file) => file.fileName).join(", ") ||
        input.title,
      200,
    );
    const status: Task["status"] = "uploaded";

    await connection.execute(
      `
        INSERT INTO tasks (
          id, graph_id, source_type, title, input_text, content_preview,
          status, error_message, idempotency_key, created_by
        )
        VALUES (
          :id, :graphId, :sourceType, :title, :inputText, :contentPreview,
          :status, NULL, :idempotencyKey, :createdBy
        )
      `,
      {
        id: taskId,
        graphId,
        sourceType: input.sourceType,
        title: input.title,
        inputText: input.content?.trim() || null,
        contentPreview,
        status,
        idempotencyKey: createId("idem"),
        createdBy: getDefaultActorId(),
      },
    );

    for (const file of input.files ?? []) {
      await connection.execute(
        `
          INSERT INTO task_files (id, task_id, file_name, mime_type, file_size, storage_key)
          VALUES (:id, :taskId, :fileName, :mimeType, :fileSize, :storageKey)
        `,
        {
          id: createId("file"),
          taskId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.size ?? null,
          storageKey: file.storageKey ?? null,
        },
      );
    }

    await appendTaskEvents(connection, taskId, [
      { type: "uploaded", message: "任务已创建，等待提交解析内容。", payload: { status: "uploaded" } },
    ]);

    return getTaskOrThrow(connection, taskId);
  });
}

export async function listTasks(params: {
  status?: string | null;
  sourceType?: string | null;
  page: number;
  pageSize: number;
}) {
  return withConnection(async (connection) => {
    const graphId = getDefaultGraphId();
    const clauses = ["t.graph_id = :graphId"];
    const queryParams: {
      graphId: string;
      status?: string;
      sourceType?: string;
    } = {
      graphId,
    };

    if (params.status) {
      clauses.push("t.status = :status");
      queryParams.status = params.status;
    }

    if (params.sourceType) {
      clauses.push("t.source_type = :sourceType");
      queryParams.sourceType = params.sourceType;
    }

    const [rows] = await connection.execute<DbRow[]>(
      `
        SELECT
          t.*,
          tr.node_count,
          tr.edge_count,
          tr.event_count
        FROM tasks t
        LEFT JOIN task_results tr ON tr.task_id = t.id
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.created_at DESC, t.updated_at DESC
      `,
      queryParams,
    );

    const taskIds = rows.map((row) => String(row.id));
    const taskFiles = new Map<string, TaskFile[]>();

    if (taskIds.length > 0) {
      const [fileRows] = await connection.execute<DbRow[]>(
        `SELECT * FROM task_files WHERE task_id IN (${taskIds.map(() => "?").join(", ")}) ORDER BY created_at ASC`,
        taskIds,
      );

      for (const row of fileRows) {
        const items = taskFiles.get(String(row.task_id)) ?? [];
        items.push(mapTaskFile(row));
        taskFiles.set(String(row.task_id), items);
      }
    }

    const tasks = rows.map((row) => mapTask(row, taskFiles.get(String(row.id)) ?? []));

    return paginate(tasks, params.page, params.pageSize) satisfies TaskListResponse;
  });
}

export async function getTaskDetail(taskId: string) {
  return withConnection(async (connection) => getTaskOrThrow(connection, taskId));
}

export async function updateTask(taskId: string, input: UpdateTaskRequest) {
  return withTransaction(async (connection) => {
    const existing = await getTaskOrThrow(connection, taskId);
    const nextTitle = input.title === undefined ? existing.title : String(input.title).trim();

    if (!nextTitle) {
      throw new ApiError(400, "BAD_REQUEST", "title is required");
    }

    if (nextTitle === existing.title) {
      return existing;
    }

    await connection.execute(
      `
        UPDATE tasks
        SET title = :title,
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :taskId
      `,
      {
        taskId,
        title: nextTitle,
      },
    );

    await connection.execute(
      `
        UPDATE source_records
        SET title = :title
        WHERE source_type = 'task' AND source_ref_id = :taskId
      `,
      {
        taskId,
        title: nextTitle,
      },
    );

    await appendTaskEvents(connection, taskId, [
      {
        type: "updated",
        message: "任务标题已更新。",
        payload: { title: nextTitle },
      },
    ]);

    return getTaskOrThrow(connection, taskId);
  });
}

export async function deleteTask(taskId: string) {
  return withTransaction(async (connection) => {
    const task = await getTaskOrThrow(connection, taskId);

    if (task.status === "applied") {
      throw new ApiError(409, "TASK_DELETE_FORBIDDEN", "Applied task cannot be deleted");
    }

    await connection.execute("DELETE FROM tasks WHERE id = :taskId", { taskId });

    return {
      id: taskId,
      deleted: true,
    } satisfies TaskDeleteResponse;
  });
}

export async function getTaskResult(taskId: string) {
  return withConnection(async (connection) => {
    const task = await getTaskOrThrow(connection, taskId);
    const record = await getTaskResultRecord(connection, taskId);

    if (!record?.normalized_result) {
      throw new ApiError(409, "TASK_RESULT_NOT_READY", "Task result is not ready yet");
    }

    return {
      taskId,
      status: task.status,
      result: fromJsonValue<AiParseResult | undefined>(record.normalized_result, undefined),
    } satisfies TaskResultResponse;
  });
}

export async function saveTaskResult(taskId: string, input: SaveTaskResultRequest) {
  return withTransaction(async (connection) => {
    await getTaskOrThrow(connection, taskId);

    const result = input?.result;
    if (!result || !Array.isArray(result.nodes) || !Array.isArray(result.edges) || !Array.isArray(result.events)) {
      throw new ApiError(400, "BAD_REQUEST", "result must contain nodes, edges and events arrays");
    }

    await connection.execute(
      `
        INSERT INTO task_results (
          id, task_id, raw_result, normalized_result, node_count, edge_count, event_count
        )
        VALUES (
          :id, :taskId, :rawResult, :normalizedResult, :nodeCount, :edgeCount, :eventCount
        )
        ON DUPLICATE KEY UPDATE
          raw_result = VALUES(raw_result),
          normalized_result = VALUES(normalized_result),
          node_count = VALUES(node_count),
          edge_count = VALUES(edge_count),
          event_count = VALUES(event_count),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      {
        id: createId("trs"),
        taskId,
        rawResult: toJsonString({ source: "manual_import", result }),
        normalizedResult: toJsonString(result),
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        eventCount: result.events.length,
      },
    );

    await connection.execute(
      `
        UPDATE tasks
        SET
          status = 'validated',
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :taskId
      `,
      { taskId },
    );

    await appendTaskEvents(connection, taskId, [
      {
        type: "manual_result_saved",
        message: "??????????????",
        payload: {
          status: "validated",
          source: "manual_import",
          nodeCount: result.nodes.length,
          edgeCount: result.edges.length,
          eventCount: result.events.length,
        },
      },
    ]);

    return {
      taskId,
      status: "validated",
      result,
    } satisfies TaskResultResponse;
  });
}

export async function aiParseContent(input: AiParseRequest) {
  const taskId = input.taskId?.trim() || createId("task_preview");
  return requestAiParseViaHttp({
    taskId,
    title: truncateText(input.content.join("\n\n").trim(), 40) || "AI 解析预览",
    input,
  });
}

export async function applyTaskResult(taskId: string) {
  return withTransaction(async (connection) => {
    const task = await getTaskOrThrow(connection, taskId);

    if (task.status === "applied") {
      return {
        taskId,
        status: "applied",
      } satisfies TaskApplyResponse;
    }

    if (task.status === "processing" || task.status === "queued") {
      throw new ApiError(409, "TASK_NOT_APPLICABLE", "Task is still processing");
    }

    if (task.status === "failed") {
      throw new ApiError(409, "TASK_NOT_APPLICABLE", "Task failed and cannot be applied");
    }

    if (task.status === "uploaded") {
      throw new ApiError(409, "TASK_NOT_APPLICABLE", "Task must be parsed before applying");
    }

    const resultRecord = await getTaskResultRecord(connection, taskId);
    const result = fromJsonValue<AiParseResult | undefined>(resultRecord?.normalized_result, undefined);

    if (!result) {
      throw new ApiError(409, "TASK_RESULT_NOT_READY", "Task result is not available");
    }

    const applied = await applyResultToGraph(connection, {
      taskId,
      title: task.title,
      graphId: getDefaultGraphId(),
      contentPreview: undefined,
      result,
    });

    return {
      taskId,
      status: applied.status,
    } satisfies TaskApplyResponse;
  });
}

export async function listTaskEvents(taskId: string) {
  return withConnection(async (connection) => {
    await getTaskOrThrow(connection, taskId);
    const [rows] = await connection.execute<DbRow[]>(
      "SELECT * FROM task_events WHERE task_id = :taskId ORDER BY seq ASC, created_at ASC",
      { taskId },
    );

    return {
      taskId,
      items: rows.map(mapTaskEvent),
    } satisfies TaskEventListResponse;
  });
}

export async function createGraphNode(input: CreateNodeRequest) {
  return withTransaction(async (connection) => {
    await ensureGraph(connection, input.graphId);

    const id = createId(input.type || "node");
    const now = nowIso();
    const node: GraphNode = {
      id,
      graphId: input.graphId,
      type: input.type,
      label: input.label,
      properties: input.properties,
      position: input.position,
      occurredAt: input.occurredAt ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      placeId: input.placeId ?? null,
      participants: input.participants ?? [],
      createdAt: now,
      updatedAt: now,
    };

    await upsertNode(connection, node);

    let sourceRecordId: string | null = null;
    if (input.source) {
      const source = await createSourceRecord(connection, input.graphId, input.source);
      sourceRecordId = source?.id ?? null;

      if (source) {
        await linkEntitySource(connection, {
          graphId: input.graphId,
          entityType: "node",
          entityId: id,
          sourceRecordId: source.id,
        });
      }
    }

    await recordChangeHistory(connection, {
      graphId: input.graphId,
      entityType: "node",
      entityId: id,
      action: "create",
      newValue: node,
      sourceRecordId,
    });

    return node;
  });
}

export async function updateGraphNode(id: string, input: UpdateNodeRequest) {
  return withTransaction(async (connection) => {
    const existing = await findNode(connection, id);

    if (!existing) {
      throw new ApiError(404, "GRAPH_NODE_NOT_FOUND", "Node not found");
    }

    const updated: GraphNode = {
      ...existing,
      label: input.label ?? existing.label,
      properties: input.properties ?? existing.properties,
      position: input.position ?? existing.position,
      occurredAt: input.occurredAt ?? existing.occurredAt,
      periodStart: input.periodStart ?? existing.periodStart,
      periodEnd: input.periodEnd ?? existing.periodEnd,
      placeId: input.placeId ?? existing.placeId,
      participants: input.participants ?? existing.participants,
      updatedAt: nowIso(),
    };

    await upsertNode(connection, updated);

    const fields: Array<[string, unknown, unknown]> = [
      ["label", existing.label, updated.label],
      ["properties", existing.properties, updated.properties],
      ["position", existing.position, updated.position],
      ["occurredAt", existing.occurredAt ?? undefined, updated.occurredAt ?? undefined],
      ["periodStart", existing.periodStart ?? undefined, updated.periodStart ?? undefined],
      ["periodEnd", existing.periodEnd ?? undefined, updated.periodEnd ?? undefined],
      ["placeId", existing.placeId ?? undefined, updated.placeId ?? undefined],
      ["participants", existing.participants, updated.participants],
    ];

    for (const [fieldName, oldValue, newValue] of fields) {
      if (JSON.stringify(oldValue ?? null) === JSON.stringify(newValue ?? null)) {
        continue;
      }

      await recordChangeHistory(connection, {
        graphId: existing.graphId,
        entityType: "node",
        entityId: id,
        action: "update",
        fieldName,
        oldValue,
        newValue,
      });
    }

    return updated;
  });
}

export async function deleteGraphNode(id: string, graphId?: string | null) {
  return withTransaction(async (connection) => {
    const existing = await findNode(connection, id);

    if (!existing || (graphId && existing.graphId !== graphId)) {
      throw new ApiError(404, "GRAPH_NODE_NOT_FOUND", "Node not found");
    }

    const [edgeRows] = await connection.execute<DbRow[]>(
      "SELECT id FROM graph_edges WHERE source_id = :id OR target_id = :id",
      { id },
    );
    const edgeIds = edgeRows.map((row) => String(row.id));

    if (edgeIds.length > 0) {
      await deleteEdgesAndAssociations(connection, edgeIds);
    }

    await recordChangeHistory(connection, {
      graphId: existing.graphId,
      entityType: "node",
      entityId: id,
      action: "delete",
      oldValue: existing,
    });

    await cleanupNodeAssociations(connection, [id]);
    await connection.execute("DELETE FROM graph_nodes WHERE id = :id", { id });

    return {
      deleted: true,
      id,
    };
  });
}

export async function createGraphEdge(input: CreateEdgeRequest) {
  return withTransaction(async (connection) => {
    await ensureGraph(connection, input.graphId);

    const sourceNode = await findNode(connection, input.sourceId);
    const targetNode = await findNode(connection, input.targetId);

    if (!sourceNode || !targetNode) {
      throw new ApiError(404, "GRAPH_NODE_NOT_FOUND", "Source or target node not found");
    }

    const id = createId("edge");
    const now = nowIso();
    const edge: GraphEdge = {
      id,
      graphId: input.graphId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      relation: input.relation,
      label: input.label ?? null,
      start: input.start ?? null,
      end: input.end ?? null,
      weight: input.weight ?? null,
      properties: input.properties,
      createdAt: now,
      updatedAt: now,
    };

    await upsertEdge(connection, edge);

    let sourceRecordId: string | null = null;
    if (input.source) {
      const source = await createSourceRecord(connection, input.graphId, input.source);
      sourceRecordId = source?.id ?? null;

      if (source) {
        await linkEntitySource(connection, {
          graphId: input.graphId,
          entityType: "edge",
          entityId: id,
          sourceRecordId: source.id,
        });

        if (input.source.content) {
          await createEvidence(connection, {
            graphId: input.graphId,
            sourceRecordId: source.id,
            subjectNodeId: input.sourceId,
            targetNodeId: input.targetId,
            edgeId: id,
            relation: input.relation,
            excerpt: input.source.content,
          });
        }
      }
    }

    await recordChangeHistory(connection, {
      graphId: input.graphId,
      entityType: "edge",
      entityId: id,
      action: "create",
      newValue: edge,
      sourceRecordId,
    });

    return edge;
  });
}

export async function updateGraphEdge(id: string, input: UpdateEdgeRequest) {
  return withTransaction(async (connection) => {
    const existing = await findEdge(connection, id);

    if (!existing) {
      throw new ApiError(404, "GRAPH_EDGE_NOT_FOUND", "Edge not found");
    }

    const updated: GraphEdge = {
      ...existing,
      relation: input.relation ?? existing.relation,
      label: input.label ?? existing.label,
      start: input.start ?? existing.start,
      end: input.end ?? existing.end,
      weight: input.weight ?? existing.weight,
      properties: input.properties ?? existing.properties,
      updatedAt: nowIso(),
    };

    await upsertEdge(connection, updated);

    const fields: Array<[string, unknown, unknown]> = [
      ["relation", existing.relation, updated.relation],
      ["label", existing.label ?? undefined, updated.label ?? undefined],
      ["start", existing.start ?? undefined, updated.start ?? undefined],
      ["end", existing.end ?? undefined, updated.end ?? undefined],
      ["weight", existing.weight ?? undefined, updated.weight ?? undefined],
      ["properties", existing.properties, updated.properties],
    ];

    for (const [fieldName, oldValue, newValue] of fields) {
      if (JSON.stringify(oldValue ?? null) === JSON.stringify(newValue ?? null)) {
        continue;
      }

      await recordChangeHistory(connection, {
        graphId: existing.graphId,
        entityType: "edge",
        entityId: id,
        action: "update",
        fieldName,
        oldValue,
        newValue,
      });
    }

    return updated;
  });
}

export async function deleteGraphEdge(id: string, graphId?: string | null) {
  return withTransaction(async (connection) => {
    const existing = await findEdge(connection, id);

    if (!existing || (graphId && existing.graphId !== graphId)) {
      throw new ApiError(404, "GRAPH_EDGE_NOT_FOUND", "Edge not found");
    }

    await recordChangeHistory(connection, {
      graphId: existing.graphId,
      entityType: "edge",
      entityId: id,
      action: "delete",
      oldValue: existing,
    });

    await deleteEdgesAndAssociations(connection, [id]);

    return {
      deleted: true,
      id,
    };
  });
}

export async function getGraphView(graphId: string) {
  return withConnection(async (connection) => {
    await ensureGraph(connection, graphId);
    const [nodes, edges] = await Promise.all([loadGraphNodes(connection, graphId), loadGraphEdges(connection, graphId)]);

    return {
      graphId,
      nodes,
      edges,
    } satisfies GraphView;
  });
}

export async function getGraphSubgraph(graphId: string, rootId: string, depth: number) {
  return withConnection(async (connection) => {
    const [nodes, edges] = await Promise.all([loadGraphNodes(connection, graphId), loadGraphEdges(connection, graphId)]);

    return createSubgraph(
      { graphId, nodes, edges },
      {
        graphId,
        rootIds: [rootId],
        depth,
      },
    );
  });
}

async function buildRelations(connection: PoolConnection, graphId: string, nodeId: string) {
  const [nodeResult, edgeResult, neighborResult] = await Promise.all([
    connection.execute<DbRow[]>("SELECT * FROM graph_nodes WHERE id = :id AND graph_id = :graphId LIMIT 1", {
      id: nodeId,
      graphId,
    }),
    connection.execute<DbRow[]>(
      "SELECT * FROM graph_edges WHERE graph_id = :graphId AND (source_id = :nodeId OR target_id = :nodeId)",
      { graphId, nodeId },
    ),
    connection.execute<DbRow[]>(
      `
        SELECT DISTINCT n.*
        FROM graph_nodes n
        JOIN graph_edges e
          ON (e.source_id = n.id OR e.target_id = n.id)
        WHERE e.graph_id = :graphId
          AND (e.source_id = :nodeId OR e.target_id = :nodeId)
          AND n.id <> :nodeId
      `,
      { graphId, nodeId },
    ),
  ]);

  const nodeRows = nodeResult[0];
  const edgeRows = edgeResult[0];
  const neighborRows = neighborResult[0];
  const node = nodeRows[0] ? mapGraphNode(nodeRows[0]) : undefined;
  if (!node) {
    throw new ApiError(404, "GRAPH_NODE_NOT_FOUND", "Node not found");
  }

  const neighbors = new Map(neighborRows.map((row) => [String(row.id), mapGraphNode(row)]));
  const relations = edgeRows.map(mapGraphEdge).flatMap((edge) => {
    const neighbor = neighbors.get(edge.sourceId === nodeId ? edge.targetId : edge.sourceId);
    return neighbor ? [{ edge, neighbor }] : [];
  });

  return {
    node,
    relations,
  };
}

export async function queryNodeRelations(graphId: string, nodeId: string) {
  return withConnection(async (connection) => {
    const result = await buildRelations(connection, graphId, nodeId);
    return result satisfies RelationsResponse;
  });
}

export async function queryNodeDetail(graphId: string, nodeId: string) {
  return withConnection(async (connection) => {
    const { node, relations } = await buildRelations(connection, graphId, nodeId);
    const [evidenceRows, historyRows, sourceRows] = await Promise.all([
      connection.execute<DbRow[]>(
        `
          SELECT
            e.*,
            s.source_type,
            s.title AS source_title
          FROM evidence_records e
          JOIN source_records s ON s.id = e.source_record_id
          WHERE e.graph_id = :graphId
            AND (e.subject_node_id = :nodeId OR e.target_node_id = :nodeId)
          ORDER BY e.created_at DESC
        `,
        { graphId, nodeId },
      ),
      connection.execute<DbRow[]>(
        `
          SELECT *
          FROM graph_change_history
          WHERE graph_id = :graphId AND entity_type = 'node' AND entity_id = :nodeId
          ORDER BY created_at DESC
        `,
        { graphId, nodeId },
      ),
      connection.execute<DbRow[]>(
        `
          SELECT s.*
          FROM source_records s
          JOIN entity_source_links l ON l.source_record_id = s.id
          WHERE l.entity_type = 'node' AND l.entity_id = :nodeId
          ORDER BY s.created_at DESC
        `,
        { nodeId },
      ),
    ]);

    const evidences: NodeDetailResponse["evidences"] = evidenceRows[0].map((row) => ({
      edgeId: row.edge_id ? String(row.edge_id) : null,
      relation: row.relation ? String(row.relation) : null,
      excerpt: String(row.excerpt),
      sourceType: String(row.source_type),
      sourceTitle: String(row.source_title),
      speaker: row.speaker ? String(row.speaker) : null,
      pageNo: typeof row.page_no === "number" ? row.page_no : null,
    }));

    const changeHistory = historyRows[0].map(mapChangeHistoryItem);
    const sourceRecords = sourceRows[0].map(mapSourceRecord);

    if (evidences.length === 0 && sourceRecords.length > 0) {
      for (const source of sourceRecords) {
        evidences.push({
          excerpt: source.content ?? source.title,
          sourceType: source.sourceType,
          sourceTitle: source.title,
        });
      }
    }

    return {
      node,
      relations,
      evidences,
      changeHistory,
    } satisfies NodeDetailResponse;
  });
}

export async function queryNodeSources(graphId: string, nodeId: string) {
  return withConnection(async (connection) => {
    const node = await findNode(connection, nodeId);
    if (!node || node.graphId !== graphId) {
      throw new ApiError(404, "GRAPH_NODE_NOT_FOUND", "Node not found");
    }

    const [sourceRows, evidenceRows] = await Promise.all([
      connection.execute<DbRow[]>(
        `
          SELECT DISTINCT s.*
          FROM source_records s
          JOIN entity_source_links l ON l.source_record_id = s.id
          WHERE l.entity_type = 'node' AND l.entity_id = :nodeId
          ORDER BY s.created_at DESC
        `,
        { nodeId },
      ),
      connection.execute<DbRow[]>(
        `
          SELECT *
          FROM evidence_records
          WHERE graph_id = :graphId AND (subject_node_id = :nodeId OR target_node_id = :nodeId)
          ORDER BY created_at DESC
        `,
        { graphId, nodeId },
      ),
    ]);

    return {
      nodeId,
      sources: sourceRows[0].map(mapSourceRecord),
      evidences: evidenceRows[0].map(mapEvidenceRecord),
    } satisfies NodeSourcesResponse;
  });
}

export async function queryNodeHistory(graphId: string, nodeId: string) {
  return withConnection(async (connection) => {
    const node = await findNode(connection, nodeId);
    if (!node || node.graphId !== graphId) {
      throw new ApiError(404, "GRAPH_NODE_NOT_FOUND", "Node not found");
    }

    const [rows] = await connection.execute<DbRow[]>(
      `
        SELECT *
        FROM graph_change_history
        WHERE graph_id = :graphId AND entity_type = 'node' AND entity_id = :nodeId
        ORDER BY created_at DESC
      `,
      { graphId, nodeId },
    );

    return {
      nodeId,
      items: rows.map(mapChangeHistoryItem),
    } satisfies NodeHistoryResponse;
  });
}

export async function queryEdgeDetail(graphId: string, edgeId: string) {
  return withConnection(async (connection) => {
    const edge = await findEdge(connection, edgeId);
    if (!edge || edge.graphId !== graphId) {
      throw new ApiError(404, "GRAPH_EDGE_NOT_FOUND", "Edge not found");
    }

    const [sourceRows, evidenceRows] = await Promise.all([
      connection.execute<DbRow[]>(
        `
          SELECT DISTINCT s.*
          FROM source_records s
          JOIN entity_source_links l ON l.source_record_id = s.id
          WHERE l.entity_type = 'edge' AND l.entity_id = :edgeId
          ORDER BY s.created_at DESC
        `,
        { edgeId },
      ),
      connection.execute<DbRow[]>(
        `
          SELECT *
          FROM evidence_records
          WHERE graph_id = :graphId AND edge_id = :edgeId
          ORDER BY created_at DESC
        `,
        { graphId, edgeId },
      ),
    ]);

    return {
      edge,
      sources: sourceRows[0].map(mapSourceRecord),
      evidences: evidenceRows[0].map(mapEvidenceRecord),
    } satisfies EdgeDetailResponse;
  });
}

export async function searchNodes(params: {
  graphId: string;
  keyword: string;
  nodeType?: string | null;
  sourceType?: string | null;
  page: number;
  pageSize: number;
}) {
  return withConnection(async (connection) => {
    const nodes = await loadGraphNodes(connection, params.graphId);
    let filtered = nodes.filter((node) => {
      if (params.nodeType && node.type !== params.nodeType) {
        return false;
      }

      const haystack = `${node.label} ${JSON.stringify(node.properties)}`.toLowerCase();
      return haystack.includes(params.keyword.toLowerCase());
    });

    if (params.sourceType) {
      const [rows] = await connection.execute<DbRow[]>(
        `
          SELECT DISTINCT l.entity_id
          FROM entity_source_links l
          JOIN source_records s ON s.id = l.source_record_id
          WHERE l.entity_type = 'node' AND l.graph_id = :graphId AND s.source_type = :sourceType
        `,
        { graphId: params.graphId, sourceType: params.sourceType },
      );
      const sourceFilteredIds = new Set(rows.map((row) => String(row.entity_id)));
      filtered = filtered.filter((node) => sourceFilteredIds.has(node.id));
    }

    const items = filtered.map((node) => ({
      node,
      matchedField: node.label.toLowerCase().includes(params.keyword.toLowerCase()) ? "label" : "properties",
      matchedText: params.keyword,
    }));

    return paginate(items, params.page, params.pageSize) satisfies NodeSearchResponse;
  });
}

export async function querySubgraph(input: SubgraphQueryRequest) {
  return withConnection(async (connection) => {
    const [nodes, edges] = await Promise.all([loadGraphNodes(connection, input.graphId), loadGraphEdges(connection, input.graphId)]);

    return createSubgraph(
      {
        graphId: input.graphId,
        nodes,
        edges,
      },
      input,
    ) satisfies SubgraphResponse;
  });
}
