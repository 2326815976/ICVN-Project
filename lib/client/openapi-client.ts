import type {
  ApplyTaskRequest,
  CreateEdgeRequest,
  CreateNodeRequest,
  CreateTaskRequest,
  CreateVersionRequest,
  EdgeDetailResponse,
  GraphEdge,
  GraphNode,
  GraphVersion,
  GraphView,
  NodeDetailResponse,
  NodeHistoryResponse,
  NodeSearchResponse,
  NodeSourcesResponse,
  PathQueryResponse,
  RelationsResponse,
  RollbackVersionRequest,
  SubgraphQueryRequest,
  SubgraphResponse,
  Task,
  TaskApplyResponse,
  TaskEventListResponse,
  TaskListResponse,
  TaskResultResponse,
  UpdateEdgeRequest,
  UpdateNodeRequest,
  VersionDetailResponse,
  VersionListResponse,
} from "@/lib/domain/models";

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
  };
};

function toQueryString(query: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload.data;
}

export const openApiClient = {
  createDocumentTask: (body: CreateTaskRequest) =>
    apiRequest<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }),

  listTasks: (query: {
    graphId: string;
    status?: string;
    sourceType?: string;
    page?: number;
    pageSize?: number;
  }) => apiRequest<TaskListResponse>(`/tasks${toQueryString(query)}`),

  getTaskDetail: (taskId: string) => apiRequest<Task>(`/tasks/${encodeURIComponent(taskId)}`),

  getTaskResult: (taskId: string) => apiRequest<TaskResultResponse>(`/tasks/${encodeURIComponent(taskId)}/result`),

  applyTaskResult: (taskId: string, body?: ApplyTaskRequest) =>
    apiRequest<TaskApplyResponse>(`/tasks/${encodeURIComponent(taskId)}/apply`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  listTaskEvents: (taskId: string) => apiRequest<TaskEventListResponse>(`/tasks/${encodeURIComponent(taskId)}/events`),

  createGraphNode: (body: CreateNodeRequest) =>
    apiRequest<GraphNode>("/graph/nodes", { method: "POST", body: JSON.stringify(body) }),

  updateGraphNode: (id: string, body: UpdateNodeRequest) =>
    apiRequest<GraphNode>(`/graph/nodes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteGraphNode: (id: string, graphId: string) =>
    apiRequest<{ deleted: boolean; id: string }>(`/graph/nodes/${encodeURIComponent(id)}${toQueryString({ graphId })}`, {
      method: "DELETE",
    }),

  createGraphEdge: (body: CreateEdgeRequest) =>
    apiRequest<GraphEdge>("/graph/edges", { method: "POST", body: JSON.stringify(body) }),

  updateGraphEdge: (id: string, body: UpdateEdgeRequest) =>
    apiRequest<GraphEdge>(`/graph/edges/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteGraphEdge: (id: string, graphId: string) =>
    apiRequest<{ deleted: boolean; id: string }>(`/graph/edges/${encodeURIComponent(id)}${toQueryString({ graphId })}`, {
      method: "DELETE",
    }),

  getGraphView: (graphId: string) => apiRequest<GraphView>(`/graph/view${toQueryString({ graphId })}`),

  getGraphSubgraph: (query: { graphId: string; rootId: string; depth?: number }) =>
    apiRequest<SubgraphResponse>(`/graph/subgraph${toQueryString(query)}`),

  queryNodeRelations: (nodeId: string, graphId: string) =>
    apiRequest<RelationsResponse>(`/query/nodes/${encodeURIComponent(nodeId)}/relations${toQueryString({ graphId })}`),

  queryNodeDetail: (nodeId: string, graphId: string) =>
    apiRequest<NodeDetailResponse>(`/query/nodes/${encodeURIComponent(nodeId)}/detail${toQueryString({ graphId })}`),

  queryNodeSources: (nodeId: string, graphId: string) =>
    apiRequest<NodeSourcesResponse>(`/query/nodes/${encodeURIComponent(nodeId)}/sources${toQueryString({ graphId })}`),

  queryNodeHistory: (nodeId: string, graphId: string) =>
    apiRequest<NodeHistoryResponse>(`/query/nodes/${encodeURIComponent(nodeId)}/history${toQueryString({ graphId })}`),

  queryEdgeDetail: (edgeId: string, graphId: string) =>
    apiRequest<EdgeDetailResponse>(`/query/edges/${encodeURIComponent(edgeId)}${toQueryString({ graphId })}`),

  searchNodes: (query: {
    graphId: string;
    keyword: string;
    nodeType?: string;
    sourceType?: string;
    page?: number;
    pageSize?: number;
  }) => apiRequest<NodeSearchResponse>(`/query/search${toQueryString(query)}`),

  queryPath: (query: {
    graphId: string;
    sourceId: string;
    targetId: string;
    maxDepth?: number;
    strategy?: "shortest" | "all";
  }) => apiRequest<PathQueryResponse>(`/query/path${toQueryString(query)}`),

  querySubgraph: (body: SubgraphQueryRequest) =>
    apiRequest<SubgraphResponse>("/query/subgraph", { method: "POST", body: JSON.stringify(body) }),

  createVersion: (body: CreateVersionRequest) =>
    apiRequest<GraphVersion>("/versions", { method: "POST", body: JSON.stringify(body) }),

  listVersions: (query: { graphId: string; page?: number; pageSize?: number }) =>
    apiRequest<VersionListResponse>(`/versions${toQueryString(query)}`),

  getVersionDetail: (versionId: string) => apiRequest<VersionDetailResponse>(`/versions/${encodeURIComponent(versionId)}`),

  rollbackVersion: (versionId: string, body: RollbackVersionRequest) =>
    apiRequest<{ rolledBackFrom: string; newVersion: GraphVersion }>(`/versions/${encodeURIComponent(versionId)}/rollback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createAiParseJob: (body: Record<string, unknown>) =>
    apiRequest<Record<string, unknown>>("/ai/parse", { method: "POST", body: JSON.stringify(body) }),

  getAiJob: (jobId: string) => apiRequest<Record<string, unknown>>(`/ai/jobs/${encodeURIComponent(jobId)}`),

  attachAiJobResultToTask: (jobId: string) =>
    apiRequest<Record<string, unknown>>(`/ai/jobs/${encodeURIComponent(jobId)}/apply`, { method: "POST" }),
};
