import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import type {
  AiJob,
  AiJobAcceptedResponse,
  AiJobStatus,
  AiParseRequest,
  AiParseResult,
  ApplyTaskRequest,
  ChangeHistoryItem,
  CreateEdgeRequest,
  CreateNodeRequest,
  CreateTaskRequest,
  CreateVersionRequest,
  EdgeDetailResponse,
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  GraphVersion,
  GraphView,
  JsonValue,
  NodeDetailResponse,
  NodeHistoryResponse,
  NodeSearchResponse,
  NodeSourcesResponse,
  RelationsResponse,
  RollbackVersionRequest,
  SourceCreateRequest,
  SourceRecord,
  SubgraphQueryRequest,
  SubgraphResponse,
  Task,
  TaskApplyResponse,
  TaskEvent,
  TaskEventListResponse,
  TaskFile,
  TaskListResponse,
  TaskResultResponse,
  TaskSummary,
  UpdateEdgeRequest,
  UpdateNodeRequest,
  VersionDetailResponse,
  VersionListResponse,
  VersionSummary,
} from "@/lib/domain/models";
import { ApiError, getDefaultActorId } from "@/lib/server/api";
import { createAllPaths, createShortestPath, createSubgraph } from "@/lib/server/graph-queries";
import { withConnection, withTransaction } from "@/lib/server/db";
import {
  buildSyntheticParseResult,
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

function mapGraphVersion(row: DbRow): GraphVersion {
  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    versionNo: Number(row.version_no),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    trigger: row.trigger as GraphVersion["trigger"],
    snapshotId: String(row.snapshot_id),
    createdBy: String(row.created_by),
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
  const currentVersion =
    row.version_id && row.version_no
      ? {
          versionId: String(row.version_id),
          versionNo: Number(row.version_no),
          name: String(row.version_name),
        }
      : null;

  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    sourceType: row.source_type as Task["sourceType"],
    title: String(row.title),
    status: row.status as Task["status"],
    files,
    contentPreview: row.content_preview ? String(row.content_preview) : undefined,
    summary: buildTaskSummary(row),
    currentVersion,
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

function mapAiJob(row: DbRow): AiJob {
  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    taskId: row.task_id ? String(row.task_id) : null,
    status: String(row.status) as AiJobStatus,
    inputText: String(row.input_text),
    result: fromJsonValue<AiParseResult | undefined>(row.result_json, undefined),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
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

async function getAiJobOrThrow(connection: PoolConnection, jobId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM ai_jobs WHERE id = :jobId LIMIT 1",
    { jobId },
  );

  if (!rows[0]) {
    throw new ApiError(404, "AI_JOB_NOT_FOUND", "AI job not found");
  }

  return rows[0];
}

async function getTaskRow(connection: PoolConnection, taskId: string) {
  const [rows] = await connection.execute<DbRow[]>(
    `
      SELECT
        t.*,
        tr.node_count,
        tr.edge_count,
        tr.event_count,
        gv.id AS version_id,
        gv.version_no,
        gv.name AS version_name
      FROM tasks t
      LEFT JOIN task_results tr ON tr.task_id = t.id
      LEFT JOIN graph_versions gv ON gv.id = t.applied_version_id
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

async function getLatestVersionSummary(connection: PoolConnection, graphId: string): Promise<VersionSummary | undefined> {
  const [rows] = await connection.execute<DbRow[]>(
    `
      SELECT id, version_no, name
      FROM graph_versions
      WHERE graph_id = :graphId
      ORDER BY version_no DESC
      LIMIT 1
    `,
    { graphId },
  );

  if (!rows[0]) {
    return undefined;
  }

  return {
    versionId: String(rows[0].id),
    versionNo: Number(rows[0].version_no),
    name: String(rows[0].name),
  };
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

async function getGraphSnapshot(connection: PoolConnection, graphId: string) {
  const [nodes, edges] = await Promise.all([loadGraphNodes(connection, graphId), loadGraphEdges(connection, graphId)]);

  return {
    graphId,
    nodes,
    edges,
  } satisfies GraphView;
}

async function createVersionRecord(
  connection: PoolConnection,
  params: {
    graphId: string;
    name: string;
    description?: string | null;
    trigger: GraphVersion["trigger"];
    createdBy?: string;
  },
) {
  const snapshot = await getGraphSnapshot(connection, params.graphId);
  const snapshotId = createId("snap");
  const versionId = createId("ver");
  const createdBy = params.createdBy ?? getDefaultActorId();

  const [versionRows] = await connection.execute<DbRow[]>(
    "SELECT COALESCE(MAX(version_no), 0) AS version_no FROM graph_versions WHERE graph_id = :graphId",
    { graphId: params.graphId },
  );

  const nextVersionNo = Number(versionRows[0]?.version_no ?? 0) + 1;
  const metadata = {
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    capturedAt: nowIso(),
  };

  await connection.execute(
    `
      INSERT INTO graph_snapshots (id, graph_id, snapshot_json, metadata)
      VALUES (:id, :graphId, :snapshotJson, :metadata)
    `,
    {
      id: snapshotId,
      graphId: params.graphId,
      snapshotJson: toJsonString(snapshot),
      metadata: toJsonString(metadata),
    },
  );

  await connection.execute(
    `
      INSERT INTO graph_versions (
        id, graph_id, version_no, name, description, \`trigger\`, snapshot_id, created_by
      )
      VALUES (
        :id, :graphId, :versionNo, :name, :description, :trigger, :snapshotId, :createdBy
      )
    `,
    {
      id: versionId,
      graphId: params.graphId,
      versionNo: nextVersionNo,
      name: params.name,
      description: params.description ?? null,
      trigger: params.trigger,
      snapshotId,
      createdBy,
    },
  );

  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_versions WHERE id = :id LIMIT 1",
    { id: versionId },
  );

  if (!rows[0]) {
    throw new ApiError(500, "VERSION_CREATE_FAILED", "Failed to create graph version");
  }

  return mapGraphVersion(rows[0]);
}

export async function createAiParseJob(input: AiParseRequest) {
  if (!input.content?.trim()) {
    throw new ApiError(400, "BAD_REQUEST", "content is required");
  }

  return withTransaction(async (connection) => {
    await ensureGraph(connection, input.graphId);

    const jobId = createId("job");
    const status: AiJobStatus = "pending";

    await connection.execute(
      `
        INSERT INTO ai_jobs (
          id, graph_id, task_id, source_type, input_text, status, result_json, error_message, provider, model
        )
        VALUES (
          :id, :graphId, NULL, :sourceType, :inputText, :status, NULL, NULL, NULL, NULL
        )
      `,
      {
        id: jobId,
        graphId: input.graphId,
        sourceType: input.sourceType,
        inputText: input.content.trim(),
        status,
      },
    );

    return {
      jobId,
      status,
      taskId: null,
    } satisfies AiJobAcceptedResponse;
  });
}

export async function getAiJob(jobId: string) {
  return withConnection(async (connection) => {
    const row = await getAiJobOrThrow(connection, jobId);
    return mapAiJob(row);
  });
}

export async function attachAiJobResultToTask(jobId: string) {
  return withTransaction(async (connection) => {
    const row = await getAiJobOrThrow(connection, jobId);
    const status = String(row.status) as AiJobStatus;

    if (status !== "validated" && status !== "applied") {
      throw new ApiError(409, "AI_JOB_NOT_READY", "AI job is not ready to attach");
    }

    return {
      jobId: String(row.id),
      status,
      taskId: row.task_id ? String(row.task_id) : null,
    };
  });
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
  if (!input.content && (!input.files || input.files.length === 0)) {
    throw new ApiError(400, "BAD_REQUEST", "Either content or files is required");
  }

  return withTransaction(async (connection) => {
    await ensureGraph(connection, input.graphId);

    const taskId = createId("task");
    const contentPreview = truncateText(
      input.content?.trim() ||
        input.files?.map((file) => file.fileName).join(", ") ||
        input.title,
      200,
    );
    const result = buildSyntheticParseResult({
      graphId: input.graphId,
      taskId,
      title: input.title,
      sourceType: input.sourceType,
      content: input.content,
      language: input.options?.language,
    });
    const status: Task["status"] = "validated";

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
        graphId: input.graphId,
        sourceType: input.sourceType,
        title: input.title,
        inputText: input.content ?? null,
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

    await connection.execute(
      `
        INSERT INTO task_results (
          id, task_id, raw_result, normalized_result, node_count, edge_count, event_count
        )
        VALUES (
          :id, :taskId, :rawResult, :normalizedResult, :nodeCount, :edgeCount, :eventCount
        )
      `,
      {
        id: createId("trs"),
        taskId,
        rawResult: toJsonString(result),
        normalizedResult: toJsonString(result),
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        eventCount: result.events.length,
      },
    );

    const eventSeed = [
      { type: "uploaded", message: "任务已创建，原始内容已接收。", payload: { status: "uploaded" } },
      { type: "queued", message: "任务已进入标准化队列。", payload: { status: "queued" } },
      { type: "processing", message: "系统已完成结构化解析。", payload: { status: "processing" } },
      { type: "validated", message: "任务结果已通过后端校验，可执行入图。", payload: { status: "validated" } },
    ] as const;

    for (const [index, event] of eventSeed.entries()) {
      await connection.execute(
        `
          INSERT INTO task_events (id, task_id, seq, event_type, message, payload)
          VALUES (:id, :taskId, :seq, :eventType, :message, :payload)
        `,
        {
          id: createId("evt"),
          taskId,
          seq: index + 1,
          eventType: event.type,
          message: event.message,
          payload: toJsonString(event.payload),
        },
      );
    }

    return getTaskOrThrow(connection, taskId);
  });
}

export async function listTasks(params: {
  graphId: string;
  status?: string | null;
  sourceType?: string | null;
  page: number;
  pageSize: number;
}) {
  return withConnection(async (connection) => {
    const clauses = ["t.graph_id = :graphId"];
    const queryParams: {
      graphId: string;
      status?: string;
      sourceType?: string;
    } = {
      graphId: params.graphId,
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
          tr.event_count,
          gv.id AS version_id,
          gv.version_no,
          gv.name AS version_name
        FROM tasks t
        LEFT JOIN task_results tr ON tr.task_id = t.id
        LEFT JOIN graph_versions gv ON gv.id = t.applied_version_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.created_at DESC
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

export async function applyTaskResult(taskId: string, input: ApplyTaskRequest) {
  return withTransaction(async (connection) => {
    const task = await getTaskOrThrow(connection, taskId);
    const graphId = input.graphId ?? task.graphId;

    if (task.status === "applied" && task.currentVersion) {
      const [versionRows] = await connection.execute<DbRow[]>(
        "SELECT * FROM graph_versions WHERE id = :id LIMIT 1",
        { id: task.currentVersion.versionId },
      );

      return {
        taskId,
        status: "applied",
        version: versionRows[0] ? mapGraphVersion(versionRows[0]) : undefined,
      } satisfies TaskApplyResponse;
    }

    if (task.status !== "validated" && task.status !== "applied") {
      throw new ApiError(409, "TASK_NOT_APPLICABLE", "Task must be validated before applying");
    }

    const resultRecord = await getTaskResultRecord(connection, taskId);
    const result = fromJsonValue<AiParseResult | undefined>(resultRecord?.normalized_result, undefined);

    if (!result) {
      throw new ApiError(409, "TASK_RESULT_NOT_READY", "Task result is not available");
    }

    await ensureGraph(connection, graphId);

    for (const node of [...result.nodes, ...result.events].map((item) => ({ ...item, graphId }))) {
      await upsertNode(connection, node);
      await recordChangeHistory(connection, {
        graphId,
        entityType: "node",
        entityId: node.id,
        action: "create",
        newValue: node,
      });
    }

    for (const edge of result.edges.map((item) => ({ ...item, graphId }))) {
      await upsertEdge(connection, edge);
      await recordChangeHistory(connection, {
        graphId,
        entityType: "edge",
        entityId: edge.id,
        action: "create",
        newValue: edge,
      });
    }

    const source = await createSourceRecord(connection, graphId, {
      sourceType: "task",
      sourceRefId: taskId,
      title: task.title,
      content: task.contentPreview ?? result.meta.summary ?? task.title,
    });

    if (source) {
      for (const node of [...result.nodes, ...result.events]) {
        await linkEntitySource(connection, {
          graphId,
          entityType: "node",
          entityId: node.id,
          sourceRecordId: source.id,
        });
      }

      for (const edge of result.edges) {
        await linkEntitySource(connection, {
          graphId,
          entityType: "edge",
          entityId: edge.id,
          sourceRecordId: source.id,
        });

        await createEvidence(connection, {
          graphId,
          sourceRecordId: source.id,
          subjectNodeId: edge.sourceId,
          targetNodeId: edge.targetId,
          edgeId: edge.id,
          relation: edge.relation,
          excerpt: result.meta.summary ?? task.contentPreview ?? `${task.title} 的结构化关系`,
        });
      }
    }

    let version: GraphVersion | undefined;
    if (input.createSnapshot ?? true) {
      version = await createVersionRecord(connection, {
        graphId,
        name: input.versionName ?? `ai-import-${new Date().toISOString().slice(0, 10)}`,
        description: `Applied from task ${taskId}`,
        trigger: "ai-import",
      });
    }

    await connection.execute(
      `
        UPDATE tasks
        SET
          status = 'applied',
          applied_version_id = :versionId,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :taskId
      `,
      {
        taskId,
        versionId: version?.id ?? null,
      },
    );

    const [seqRows] = await connection.execute<DbRow[]>(
      "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM task_events WHERE task_id = :taskId",
      { taskId },
    );
    await connection.execute(
      `
        INSERT INTO task_events (id, task_id, seq, event_type, message, payload)
        VALUES (:id, :taskId, :seq, 'applied', :message, :payload)
      `,
      {
        id: createId("evt"),
        taskId,
        seq: Number(seqRows[0]?.max_seq ?? 0) + 1,
        message: version ? "任务结果已入图，并生成新版本。" : "任务结果已入图。",
        payload: toJsonString({
          versionId: version?.id ?? null,
        }),
      },
    );

    return {
      taskId,
      status: "applied",
      version,
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
    const [nodes, edges, version] = await Promise.all([
      loadGraphNodes(connection, graphId),
      loadGraphEdges(connection, graphId),
      getLatestVersionSummary(connection, graphId),
    ]);

    return {
      graphId,
      nodes,
      edges,
      version,
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

export async function queryPath(params: {
  graphId: string;
  sourceId: string;
  targetId: string;
  maxDepth: number;
  strategy: "shortest" | "all";
}) {
  return withConnection(async (connection) => {
    const [nodes, edges] = await Promise.all([
      loadGraphNodes(connection, params.graphId),
      loadGraphEdges(connection, params.graphId),
    ]);
    const data = { graphId: params.graphId, nodes, edges };

    const paths =
      params.strategy === "all"
        ? createAllPaths(data, params.sourceId, params.targetId, params.maxDepth)
        : [createShortestPath(data, params.sourceId, params.targetId, params.maxDepth)].filter(
            (item): item is NonNullable<ReturnType<typeof createShortestPath>> => Boolean(item),
          );

    return {
      paths,
    };
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

export async function createVersion(input: CreateVersionRequest) {
  return withTransaction(async (connection) => {
    await ensureGraph(connection, input.graphId);
    return createVersionRecord(connection, {
      graphId: input.graphId,
      name: input.name,
      description: input.description,
      trigger: input.trigger,
    });
  });
}

export async function listVersions(graphId: string, page: number, pageSize: number) {
  return withConnection(async (connection) => {
    const [rows] = await connection.execute<DbRow[]>(
      `
        SELECT *
        FROM graph_versions
        WHERE graph_id = :graphId
        ORDER BY version_no DESC
      `,
      { graphId },
    );

    return paginate(rows.map(mapGraphVersion), page, pageSize) satisfies VersionListResponse;
  });
}

export async function getVersionDetail(versionId: string) {
  return withConnection(async (connection) => {
    const { version, snapshotRow } = await getVersionWithSnapshot(connection, versionId);

    const metadata = fromJsonValue<{ nodeCount: number; edgeCount: number; capturedAt: string } | undefined>(
      snapshotRow?.metadata,
      undefined,
    );

    return {
      version,
      snapshotSummary: metadata,
      diff: null,
    } satisfies VersionDetailResponse;
  });
}

async function getVersionWithSnapshot(connection: PoolConnection, versionId: string) {
  const [versionRows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_versions WHERE id = :id LIMIT 1",
    { id: versionId },
  );

  if (!versionRows[0]) {
    throw new ApiError(404, "VERSION_NOT_FOUND", "Version not found");
  }

  const version = mapGraphVersion(versionRows[0]);
  const [snapshotRows] = await connection.execute<DbRow[]>(
    "SELECT * FROM graph_snapshots WHERE id = :id LIMIT 1",
    { id: version.snapshotId },
  );

  return {
    version,
    snapshotRow: snapshotRows[0] ?? null,
  };
}

export async function rollbackVersion(versionId: string, input: RollbackVersionRequest) {
  return withTransaction(async (connection) => {
    const { version, snapshotRow } = await getVersionWithSnapshot(connection, versionId);

    if (version.graphId !== input.graphId) {
      throw new ApiError(409, "VERSION_GRAPH_MISMATCH", "Version does not belong to the specified graph");
    }

    const snapshot = fromJsonValue<GraphView | undefined>(snapshotRow?.snapshot_json, undefined);

    if (!snapshot) {
      throw new ApiError(409, "SNAPSHOT_NOT_FOUND", "Snapshot payload is missing");
    }

    const existingEdges = await loadGraphEdges(connection, input.graphId);
    if (existingEdges.length > 0) {
      await deleteEdgesAndAssociations(
        connection,
        existingEdges.map((edge) => edge.id),
      );
    }

    const existingNodes = await loadGraphNodes(connection, input.graphId);
    if (existingNodes.length > 0) {
      await cleanupNodeAssociations(
        connection,
        existingNodes.map((node) => node.id),
      );
      await connection.execute("DELETE FROM graph_nodes WHERE graph_id = :graphId", { graphId: input.graphId });
    }

    for (const node of snapshot.nodes) {
      await upsertNode(connection, node);
    }

    for (const edge of snapshot.edges) {
      await upsertEdge(connection, edge);
    }

    const newVersion = await createVersionRecord(connection, {
      graphId: input.graphId,
      name: `rollback-${version.versionNo}`,
      description: input.reason ?? `Rollback from ${version.id}`,
      trigger: "rollback",
    });

    return {
      rolledBackFrom: versionId,
      newVersion,
    };
  });
}
