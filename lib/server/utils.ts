import { randomUUID } from "crypto";

import type { AiParseResult, GraphEdge, GraphNode, JsonValue, TaskSourceType } from "@/lib/domain/models";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  // Keep generated ids below MySQL VARCHAR(64) limits used by core tables.
  const sanitizedPrefix = prefix.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24) || "id";
  const token = randomUUID().replace(/-/g, "").slice(0, 24);
  return `${sanitizedPrefix}_${token}`;
}

export function truncateText(value: string, length = 200) {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 3))}...`;
}

export function toJsonString(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function fromJsonValue<T>(value: unknown, fallback: T) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

export function coerceRecord(value: unknown) {
  const record = fromJsonValue<Record<string, JsonValue>>(value, {});
  return typeof record === "object" && record && !Array.isArray(record) ? record : {};
}

export function coerceStringArray(value: unknown) {
  const items = fromJsonValue<unknown[]>(value, []);
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return {
    items: paged,
    page,
    pageSize,
    total: items.length,
  };
}

const chineseStopWords = new Set([
  "人物",
  "关系",
  "任务",
  "图谱",
  "文档",
  "解析",
  "结果",
  "版本",
  "内容",
  "数据",
  "系统",
  "处理",
  "应用",
]);

export function extractEntityCandidates(text: string) {
  const matches = [
    ...(text.match(/\b[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*\b/g) ?? []),
    ...(text.match(/[\u4e00-\u9fa5]{2,6}/g) ?? []),
  ];

  const unique = new Set<string>();

  for (const raw of matches) {
    const value = raw.trim();
    if (!value || chineseStopWords.has(value)) {
      continue;
    }

    unique.add(value);
    if (unique.size >= 6) {
      break;
    }
  }

  return [...unique];
}

export function buildSyntheticParseResult(input: {
  graphId: string;
  taskId: string;
  title: string;
  sourceType: TaskSourceType;
  content?: string;
  language?: string;
}): AiParseResult {
  const createdAt = nowIso();
  const content = input.content?.trim() ?? "";
  const summaryText = content || input.title;
  const entityLabels = extractEntityCandidates(`${input.title}\n${content}`);

  const nodes: GraphNode[] = entityLabels.map((label, index) => ({
    id: createId(`node_${input.taskId}_${index + 1}`),
    graphId: input.graphId,
    type: "person",
    label,
    properties: {
      inferredBy: "synthetic-task-parser",
      sourceType: input.sourceType,
    },
    position: {
      x: 160 + index * 220,
      y: 140,
    },
    createdAt,
    updatedAt: createdAt,
  }));

  const eventNode: GraphNode = {
    id: createId(`event_${input.taskId}`),
    graphId: input.graphId,
    type: "event",
    label: input.title,
    properties: {
      inferredBy: "synthetic-task-parser",
      preview: truncateText(summaryText, 120),
    },
    position: {
      x: 220,
      y: 340,
    },
    participants: nodes.map((node) => node.id),
    createdAt,
    updatedAt: createdAt,
  };

  const edges: GraphEdge[] = nodes.map((node, index) => ({
    id: createId(`edge_${input.taskId}_${index + 1}`),
    graphId: input.graphId,
    sourceId: node.id,
    targetId: eventNode.id,
    relation: "participated_in",
    label: "参与",
    properties: {
      inferredBy: "synthetic-task-parser",
    },
    createdAt,
    updatedAt: createdAt,
  }));

  return {
    meta: {
      sourceType: input.sourceType,
      language: input.language ?? "zh-CN",
      summary: truncateText(summaryText, 160),
      provider: "local",
      model: "synthetic-task-parser",
    },
    nodes,
    edges,
    events: [eventNode],
  };
}
