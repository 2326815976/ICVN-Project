export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type GraphNodeType = string;
export type TaskStatus = "uploaded" | "queued" | "processing" | "validated" | "applied" | "failed";
export type TaskSourceType = "document" | "text" | "news" | "social" | "story" | "custom";
export type SourceType = "manual" | "task" | "import" | "ai";

export interface Position {
  x: number;
  y: number;
}

export interface SourceCreateRequest {
  sourceType: SourceType;
  sourceRefId?: string | null;
  title: string;
  content?: string | null;
}

export interface SourceRecord extends SourceCreateRequest {
  id: string;
  graphId: string;
  createdBy?: string | null;
  createdAt: string;
}

export interface EvidenceRecord {
  id: string;
  sourceRecordId: string;
  subjectNodeId: string;
  targetNodeId?: string | null;
  edgeId?: string | null;
  relation?: string | null;
  excerpt: string;
  speaker?: string | null;
  pageNo?: number | null;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  graphId: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, JsonValue>;
  position?: Position;
  occurredAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  placeId?: string | null;
  participants?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  graphId: string;
  sourceId: string;
  targetId: string;
  relation: string;
  label?: string | null;
  start?: string | null;
  end?: string | null;
  weight?: number | null;
  properties: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeHistoryItem {
  id: string;
  entityType: "node" | "edge";
  entityId: string;
  action: "create" | "update" | "delete";
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  operatorId: string;
  createdAt: string;
}

export interface RelationItem {
  edge: GraphEdge;
  neighbor: GraphNode;
}

export interface NodeEvidenceItem {
  edgeId?: string | null;
  relation?: string | null;
  excerpt: string;
  sourceType: string;
  sourceTitle: string;
  speaker?: string | null;
  pageNo?: number | null;
}

export interface NodeDetailResponse {
  node: GraphNode;
  relations: RelationItem[];
  evidences: NodeEvidenceItem[];
  changeHistory: ChangeHistoryItem[];
}

export interface NodeSourcesResponse {
  nodeId: string;
  sources: SourceRecord[];
  evidences: EvidenceRecord[];
}

export interface EdgeDetailResponse {
  edge: GraphEdge;
  sources: SourceRecord[];
  evidences: EvidenceRecord[];
}

export interface NodeSearchItem {
  node: GraphNode;
  matchedField?: string;
  matchedText?: string;
}

export interface NodeSearchResponse {
  items: NodeSearchItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GraphView {
  graphId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SubgraphResponse {
  graphId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TaskFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  size?: number;
  storageKey?: string;
}

export interface TaskFileInput {
  fileName: string;
  mimeType: string;
  size?: number;
  storageKey?: string;
  contentBase64?: string;
}

export interface CreateTaskRequest {
  sourceType: TaskSourceType;
  title: string;
  content?: string;
  files?: TaskFileInput[];
  options?: {
    language?: string;
  };
}

export interface TaskSummary {
  nodeCount: number;
  edgeCount: number;
  eventCount: number;
}

export interface Task {
  id: string;
  sourceType: TaskSourceType;
  title: string;
  status: TaskStatus;
  files?: TaskFile[];
  summary?: TaskSummary;
  errorMessage?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskListResponse {
  items: Task[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  message: string;
  payload?: Record<string, JsonValue>;
  createdAt: string;
}

export interface TaskEventListResponse {
  taskId: string;
  items: TaskEvent[];
}

export interface AiParseResultMeta {
  sourceType: string;
  language?: string;
  summary?: string;
  provider?: string;
  model?: string;
}

export interface AiParseResult {
  meta: AiParseResultMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  events: GraphNode[];
}

export interface AiRawParseMeta {
  provider: string;
  model: string;
}

export interface AiInterrogatedPerson {
  id: string;
  name?: string;
  sex?: string;
  birthday?: string;
  IDnumber?: string;
  regPlace?: string;
  nowPlace?: string;
  occupation?: string;
  family?: string;
  criminal?: string;
  remark?: string;
}

export interface AiEventPerson {
  name: string;
}

export interface AiRawEvent {
  eventID: string;
  name1?: string;
  name2?: string;
  eventDescription?: string;
  eventOverview?: string;
}

export interface AiRawParseResult {
  meta: AiRawParseMeta;
  interrogatedPerson: AiInterrogatedPerson[];
  eventPerson: AiEventPerson[];
  events: AiRawEvent[];
}

export interface AiRawParseResponse {
  taskId: string;
  type: string;
  result: AiRawParseResult;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiParseRequest {
  taskId?: string;
  content: string[];
}

export interface TaskParseResponse {
  taskId: string;
  status: TaskStatus;
}

export interface TaskDeleteResponse {
  id: string;
  deleted: boolean;
}

export interface TaskResultResponse {
  taskId: string;
  status: TaskStatus;
  result?: AiParseResult;
}

export interface TaskApplyResponse {
  taskId: string;
  status: TaskStatus;
}

export interface CreateNodeRequest {
  graphId: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, JsonValue>;
  position?: Position;
  occurredAt?: string;
  periodStart?: string;
  periodEnd?: string;
  placeId?: string;
  participants?: string[];
  source?: SourceCreateRequest;
}

export interface UpdateNodeRequest {
  label?: string;
  properties?: Record<string, JsonValue>;
  position?: Position;
  occurredAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  placeId?: string | null;
  participants?: string[];
}

export interface CreateEdgeRequest {
  graphId: string;
  sourceId: string;
  targetId: string;
  relation: string;
  label?: string;
  start?: string | null;
  end?: string | null;
  weight?: number | null;
  properties: Record<string, JsonValue>;
  source?: SourceCreateRequest;
}

export interface UpdateEdgeRequest {
  relation?: string;
  label?: string | null;
  start?: string | null;
  end?: string | null;
  weight?: number | null;
  properties?: Record<string, JsonValue>;
}

export interface RelationsResponse {
  node: GraphNode;
  relations: RelationItem[];
}

export interface NodeHistoryResponse {
  nodeId: string;
  items: ChangeHistoryItem[];
}

export interface SubgraphQueryRequest {
  graphId: string;
  rootIds: string[];
  depth: number;
  relationFilters?: string[];
  nodeTypes?: string[];
}
