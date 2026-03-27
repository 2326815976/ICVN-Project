import {
  createLineNode,
  createRelationEdge,
  createShapeNode,
  defaultViewport,
  getTextVisualUnits,
  isEdgeLabelAnchorPosition,
  isEdgeLabelOffset,
  isEdgeRouteMode,
  isEdgeRoutePoints,
  isLineAnchor,
  isLineKind,
  isShapeKind,
  SHAPE_NODE_DIMENSIONS,
  type AppEdge,
  type AppNode,
  type EdgeMarkerStyle,
  type EdgePathStyle,
  type GraphDocument,
  type ShapeNodeKind,
} from "./graph/sample-graph";

function getSafeViewport(document: Partial<GraphDocument>) {
  return document.viewport &&
    typeof document.viewport.x === "number" &&
    typeof document.viewport.y === "number" &&
    typeof document.viewport.zoom === "number"
    ? document.viewport
    : defaultViewport;
}

function isPathStyle(value: unknown): value is EdgePathStyle {
  return value === "smoothstep" || value === "straight" || value === "step";
}

function isMarkerStyle(value: unknown): value is EdgeMarkerStyle {
  return value === "arrow" || value === "none";
}

export function isShapeNode(node: AppNode | null): node is Extract<AppNode, { type: "shapeNode" }> {
  return Boolean(node && node.type === "shapeNode");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function shouldIgnoreCanvasGestureTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return true;
  }

  return Boolean(
    target.closest(
      [
        ".react-flow__node",
        ".react-flow__edge",
        ".react-flow__controls",
        ".react-flow__minimap",
        ".react-flow__panel",
        "button",
        "input",
        "textarea",
        "select",
        "summary",
        "details",
        ".nodrag",
      ].join(", "),
    ),
  );
}

export function getObjectRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function mapBackendNodeKind(nodeType: unknown): ShapeNodeKind | undefined {
  if (nodeType === "person") {
    return "rounded";
  }

  if (nodeType === "place") {
    return "ellipse";
  }

  if (nodeType === "event") {
    return "diamond";
  }

  if (nodeType === "company" || nodeType === "organization") {
    return "rectangle";
  }

  return undefined;
}

function getBackendNodeImageUrl(data: Record<string, unknown>, node: { [key: string]: unknown }) {
  if (typeof data.imageUrl === "string") {
    return data.imageUrl;
  }

  const properties = getObjectRecord(node.properties);
  const candidates = [
    properties.imageUrl,
    properties.avatar,
    properties.avatarUrl,
    properties.photo,
    properties.photoUrl,
    properties.logo,
    properties.logoUrl,
  ];

  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function asDisplayText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function appendDisplayLine(lines: string[], label: string, value: unknown) {
  const text = asDisplayText(value);
  if (!text) {
    return;
  }

  lines.push(`${label}：${text}`);
}

function buildBackendNodeText(node: { [key: string]: unknown }, data: Record<string, unknown>) {
  const properties = getObjectRecord(node.properties);
  const label =
    asDisplayText(data.title) ||
    asDisplayText(node.label) ||
    asDisplayText(properties.name) ||
    asDisplayText(properties.taskId) ||
    "未命名节点";
  const lines: string[] = [label];

  if (node.type === "person") {
    appendDisplayLine(lines, "ID", properties.id);
    appendDisplayLine(lines, "性别", properties.sex);
    appendDisplayLine(lines, "生日", properties.birthday);
    appendDisplayLine(lines, "证件号", properties.IDnumber);
    appendDisplayLine(lines, "户籍地", properties.regPlace);
    appendDisplayLine(lines, "现住地", properties.nowPlace);
    appendDisplayLine(lines, "职业", properties.occupation);
    appendDisplayLine(lines, "家庭", properties.family);
    appendDisplayLine(lines, "前科", properties.criminal);
    appendDisplayLine(lines, "备注", properties.remark);
    return lines.join("\n");
  }

  if (node.type === "event") {
    appendDisplayLine(lines, "事件ID", properties.eventID);
    appendDisplayLine(lines, "人物1", properties.name1);
    appendDisplayLine(lines, "人物2", properties.name2);
    appendDisplayLine(lines, "概述", properties.eventOverview);
    appendDisplayLine(lines, "描述", properties.eventDescription);
    return lines.join("\n");
  }

  const fallbackEntries = Object.entries(properties).filter(([key]) => !["inferredBy", "sourceType"].includes(key));
  for (const [key, value] of fallbackEntries) {
    appendDisplayLine(lines, key, value);
  }

  return lines.join("\n");
}

function estimateBackendShapeSize(kind: ShapeNodeKind, text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const longestLineUnits = lines.reduce((max, line) => Math.max(max, getTextVisualUnits(line)), 0);
  const lineCount = Math.max(lines.length, 1);
  const base = SHAPE_NODE_DIMENSIONS[kind];

  if (kind === "diamond") {
    const span = Math.max(Math.ceil(longestLineUnits * 14 + 148), lineCount * 30 + 148, base.width);
    return {
      width: Math.min(span, 560),
      height: Math.min(span, 560),
    };
  }

  const widthPadding = kind === "ellipse" ? 72 : 48;
  const heightPadding = kind === "ellipse" ? 44 : 36;

  return {
    width: Math.min(Math.max(base.width, Math.ceil(longestLineUnits * 14 + widthPadding + 24)), 560),
    height: Math.min(Math.max(base.height, lineCount * 24 + heightPadding + 16), 420),
  };
}

function resolveGraphPayload(parsed: unknown) {
  const root = getObjectRecord(parsed);

  const mergeTaskResultPayload = (payload: Record<string, unknown>) => {
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const edges = Array.isArray(payload.edges) ? payload.edges : [];
    const events = Array.isArray(payload.events) ? payload.events : [];

    if (nodes.length > 0 || edges.length > 0 || events.length > 0) {
      return {
        ...payload,
        nodes: [...nodes, ...events],
        edges,
      };
    }

    return null;
  };

  if (Array.isArray(root.nodes) && Array.isArray(root.edges)) {
    return root;
  }

  const data = getObjectRecord(root.data);
  if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
    return mergeTaskResultPayload(data) ?? data;
  }

  const taskResult = getObjectRecord(data.result);
  if (Array.isArray(taskResult.nodes) && Array.isArray(taskResult.edges)) {
    return mergeTaskResultPayload(taskResult) ?? taskResult;
  }

  const rootResult = getObjectRecord(root.result);
  if (Array.isArray(rootResult.nodes) && Array.isArray(rootResult.edges)) {
    return mergeTaskResultPayload(rootResult) ?? rootResult;
  }

  throw new Error("导入格式无效，需要包含 nodes 和 edges，或使用后端 /graph/view、/tasks/{taskId}/result 返回结构。");
}

function normalizeNode(node: { [key: string]: unknown }, index: number): AppNode {
  const data = typeof node.data === "object" && node.data !== null ? (node.data as Record<string, unknown>) : {};
  const position =
    typeof node.position === "object" &&
    node.position !== null &&
    typeof (node.position as { x?: unknown }).x === "number" &&
    typeof (node.position as { y?: unknown }).y === "number"
      ? { x: (node.position as { x: number }).x, y: (node.position as { y: number }).y }
      : undefined;

  if (node.type === "lineNode" || isLineKind(data.kind)) {
    return createLineNode(
      {
        id: typeof node.id === "string" ? node.id : undefined,
        position,
        width: typeof node.width === "number" ? node.width : undefined,
        height: typeof node.height === "number" ? node.height : undefined,
        initialWidth: typeof node.initialWidth === "number" ? node.initialWidth : undefined,
        initialHeight: typeof node.initialHeight === "number" ? node.initialHeight : undefined,
        data: {
          kind: isLineKind(data.kind) ? data.kind : "solid",
          text:
            typeof data.text === "string"
              ? data.text
              : typeof node.label === "string"
                ? node.label
                : "",
          color: typeof data.color === "string" ? data.color : undefined,
          anchorStart: isLineAnchor(data.anchorStart) ? data.anchorStart : undefined,
          anchorEnd: isLineAnchor(data.anchorEnd) ? data.anchorEnd : undefined,
        },
      },
      index,
    );
  }

  const legacyLines = Array.isArray(data.notes)
    ? data.notes.filter((item): item is string => typeof item === "string")
    : Array.isArray(data.lines)
      ? data.lines.filter((item): item is string => typeof item === "string")
      : [];
  const kind =
    (isShapeKind(data.kind) ? data.kind : undefined) ??
    mapBackendNodeKind(node.type) ??
    (node.type === "tagNode" ? "rectangle" : node.type === "personCard" ? "rounded" : "rectangle");
  const nodeText =
    typeof data.text === "string"
      ? data.text
      : buildBackendNodeText(node, {
          ...data,
          subtitle: typeof data.subtitle === "string" ? data.subtitle : "",
          legacyLines,
        });
  const estimatedSize = estimateBackendShapeSize(kind, nodeText);

  return createShapeNode(
    {
      id: typeof node.id === "string" ? node.id : undefined,
      position,
      width: typeof node.width === "number" ? node.width : estimatedSize.width,
      height: typeof node.height === "number" ? node.height : estimatedSize.height,
      initialWidth: typeof node.initialWidth === "number" ? node.initialWidth : estimatedSize.width,
      initialHeight: typeof node.initialHeight === "number" ? node.initialHeight : estimatedSize.height,
      data: {
        kind,
        text: nodeText,
        imageUrl: getBackendNodeImageUrl(data, node),
        fillColor: typeof data.fillColor === "string" ? data.fillColor : undefined,
        strokeColor: typeof data.strokeColor === "string" ? data.strokeColor : undefined,
        textColor: typeof data.textColor === "string" ? data.textColor : undefined,
      },
    },
    index,
  );
}

function normalizeEdge(edge: { [key: string]: unknown }, index: number): AppEdge {
  const data = typeof edge.data === "object" && edge.data !== null ? (edge.data as Record<string, unknown>) : {};
  const style = typeof edge.style === "object" && edge.style !== null ? (edge.style as Record<string, unknown>) : {};
  const markerEnd = typeof edge.markerEnd === "object" && edge.markerEnd !== null ? edge.markerEnd : undefined;
  const properties = getObjectRecord(edge.properties);

  return createRelationEdge(
    {
      id: typeof edge.id === "string" ? edge.id : undefined,
      source:
        typeof edge.source === "string"
          ? edge.source
          : typeof edge.sourceId === "string"
            ? edge.sourceId
            : "",
      target:
        typeof edge.target === "string"
          ? edge.target
          : typeof edge.targetId === "string"
            ? edge.targetId
            : "",
      sourceHandle:
        typeof edge.sourceHandle === "string"
          ? edge.sourceHandle
          : typeof properties.sourceHandle === "string"
            ? properties.sourceHandle
            : undefined,
      targetHandle:
        typeof edge.targetHandle === "string"
          ? edge.targetHandle
          : typeof properties.targetHandle === "string"
            ? properties.targetHandle
            : undefined,
      label:
        typeof edge.label === "string"
          ? edge.label
          : typeof edge.relation === "string"
            ? edge.relation
            : "",
      data: {
        pathStyle: isPathStyle(data.pathStyle)
          ? data.pathStyle
          : edge.type === "straight"
            ? "straight"
            : edge.type === "step"
              ? "step"
              : "smoothstep",
        dashed:
          typeof data.dashed === "boolean"
            ? data.dashed
            : typeof style.strokeDasharray === "string" && style.strokeDasharray.length > 0,
        marker: isMarkerStyle(data.marker) ? data.marker : markerEnd ? "arrow" : "none",
        color: typeof data.color === "string" ? data.color : undefined,
        labelOffset: isEdgeLabelOffset(data.labelOffset) ? data.labelOffset : undefined,
        labelAnchorPosition: isEdgeLabelAnchorPosition(data.labelAnchorPosition) ? data.labelAnchorPosition : undefined,
        manualRoute: isEdgeRoutePoints(data.manualRoute) ? data.manualRoute : undefined,
        manualRouteMode: isEdgeRouteMode(data.manualRouteMode) ? data.manualRouteMode : undefined,
      },
    },
    index,
  );
}

export function sanitizeNodeForDocument(node: AppNode): AppNode {
  const cloned = structuredClone(node) as AppNode & {
    selected?: boolean;
    dragging?: boolean;
    resizing?: boolean;
  };

  delete cloned.selected;
  delete cloned.dragging;
  delete cloned.resizing;

  return cloned;
}

export function sanitizeEdgeForDocument(edge: AppEdge): AppEdge {
  const cloned = structuredClone(edge) as AppEdge & {
    selected?: boolean;
  };

  delete cloned.selected;

  return cloned;
}

export function syncSelectedFlags<T extends { id: string; selected?: boolean }>(items: T[], selectedIds: Set<string>) {
  let hasChanged = false;

  const nextItems = items.map((item) => {
    const isSelected = selectedIds.has(item.id);
    if (Boolean(item.selected) === isSelected) {
      return item;
    }

    hasChanged = true;
    return {
      ...item,
      selected: isSelected,
    };
  });

  return hasChanged ? nextItems : items;
}

export function parseGraphDocument(text: string): GraphDocument {
  const parsed = JSON.parse(text) as Partial<GraphDocument> & {
    nodes?: Array<{ [key: string]: unknown }>;
    edges?: Array<{ [key: string]: unknown }>;
  };
  const payload = resolveGraphPayload(parsed) as Partial<GraphDocument> & {
    nodes?: Array<{ [key: string]: unknown }>;
    edges?: Array<{ [key: string]: unknown }>;
    events?: Array<{ [key: string]: unknown }>;
  };

  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    throw new Error("导入格式无效，需要包含 nodes 和 edges 数组。");
  }

  const mergedNodes = [...payload.nodes, ...(Array.isArray(payload.events) ? payload.events : [])].filter(
    (node, index, array) => {
      const nodeId = typeof node.id === "string" ? node.id : "";
      if (!nodeId) {
        return true;
      }

      return index === array.findIndex((candidate) => candidate.id === nodeId);
    },
  );

  return {
    nodes: mergedNodes.map(normalizeNode).filter((node) => node.type !== "lineNode"),
    edges: payload.edges.map(normalizeEdge),
    viewport: getSafeViewport("viewport" in payload ? payload : parsed),
  };
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图片读取失败，请重试。"));
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}

export async function readFileAsBase64(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const [, base64 = ""] = dataUrl.split(",", 2);

  if (!base64) {
    throw new Error("文件读取失败，请重试。");
  }

  return base64;
}

export const SUPPORTED_DOCUMENT_EXTENSIONS = [".doc", ".docx", ".txt"] as const;

export function isSupportedDocumentFile(file: File) {
  const fileName = file.name.toLowerCase();
  return SUPPORTED_DOCUMENT_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLegacyWordText(raw: string) {
  const matches = raw.match(/[\u4e00-\u9fa5A-Za-z0-9，。；：“”‘’！？、（）()《》【】—…\-_\n\r\t ]{2,}/g) ?? [];
  return normalizeExtractedText(matches.join("\n"));
}

export async function extractTextFromDocument(file: File) {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });

    return normalizeExtractedText(result.value);
  }

  if (fileName.endsWith(".doc")) {
    const arrayBuffer = await file.arrayBuffer();
    const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
    const extractedUtf8 = extractLegacyWordText(utf8Text);
    if (extractedUtf8) {
      return extractedUtf8;
    }

    const gbText = new TextDecoder("gb18030", { fatal: false }).decode(arrayBuffer);
    const extractedGb = extractLegacyWordText(gbText);
    if (extractedGb) {
      return extractedGb;
    }

    throw new Error("暂时无法从该 .doc 文件中提取文本，请优先转换为 .docx 或 .txt 后重试。");
  }

  return normalizeExtractedText(await file.text());
}

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
    : false;
}
