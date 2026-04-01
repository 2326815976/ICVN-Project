import type {
  AiParseRequest,
  CreateEdgeRequest,
  CreateNodeRequest,
  CreateTaskRequest,
  EdgeDetailResponse,
  GraphEdge,
  GraphNode,
  GraphView,
  NodeDetailResponse,
  NodeHistoryResponse,
  NodeSearchResponse,
  NodeSourcesResponse,
  RelationsResponse,
  SaveTaskResultRequest,
  SubgraphQueryRequest,
  SubgraphResponse,
  Task,
  TaskApplyResponse,
  TaskDeleteResponse,
  TaskEventListResponse,
  TaskListResponse,
  TaskParseResponse,
  TaskResultResponse,
  UpdateTaskRequest,
  UpdateEdgeRequest,
  UpdateNodeRequest,
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
    status?: string;
    sourceType?: string;
    page?: number;
    pageSize?: number;
  }) => apiRequest<TaskListResponse>(`/tasks${toQueryString(query)}`),

  getTaskDetail: (taskId: string) => apiRequest<Task>(`/tasks/${encodeURIComponent(taskId)}`),

  updateTask: (taskId: string, body: UpdateTaskRequest) =>
    apiRequest<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteTask: (taskId: string) =>
    apiRequest<TaskDeleteResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    }),

  getTaskResult: (taskId: string) => apiRequest<TaskResultResponse>(`/tasks/${encodeURIComponent(taskId)}/result`),

  saveTaskResult: (taskId: string, body: SaveTaskResultRequest) =>
    apiRequest<TaskResultResponse>(`/tasks/${encodeURIComponent(taskId)}/result`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  applyTaskResult: (taskId: string) =>
    apiRequest<TaskApplyResponse>(`/tasks/${encodeURIComponent(taskId)}/apply`, {
      method: "POST",
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

  querySubgraph: (body: SubgraphQueryRequest) =>
    apiRequest<SubgraphResponse>("/query/subgraph", { method: "POST", body: JSON.stringify(body) }),

  parseTaskContent: (taskId: string, body: AiParseRequest) =>
    apiRequest<TaskParseResponse>(`/tasks/${encodeURIComponent(taskId)}/parse`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
