import {
  createLineNode,
  createRelationEdge,
  createShapeNode,
  defaultViewport,
  isEdgeLabelAnchorPosition,
  isEdgeLabelOffset,
  isEdgeRouteMode,
  isEdgeRoutePoints,
  isLineAnchor,
  isLineKind,
  isShapeKind,
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

function resolveGraphPayload(parsed: unknown) {
  const root = getObjectRecord(parsed);

  if (Array.isArray(root.nodes) && Array.isArray(root.edges)) {
    return root;
  }

  const data = getObjectRecord(root.data);
  if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
    return data;
  }

  const taskResult = getObjectRecord(data.result);
  if (Array.isArray(taskResult.nodes) && Array.isArray(taskResult.edges)) {
    return taskResult;
  }

  const rootResult = getObjectRecord(root.result);
  if (Array.isArray(rootResult.nodes) && Array.isArray(rootResult.edges)) {
    return rootResult;
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

  return createShapeNode(
    {
      id: typeof node.id === "string" ? node.id : undefined,
      position,
      width: typeof node.width === "number" ? node.width : undefined,
      height: typeof node.height === "number" ? node.height : undefined,
      initialWidth: typeof node.initialWidth === "number" ? node.initialWidth : undefined,
      initialHeight: typeof node.initialHeight === "number" ? node.initialHeight : undefined,
      data: {
        kind:
          (isShapeKind(data.kind) ? data.kind : undefined) ??
          mapBackendNodeKind(node.type) ??
          (node.type === "tagNode" ? "rectangle" : node.type === "personCard" ? "rounded" : "rectangle"),
        text:
          typeof data.text === "string"
            ? data.text
            : [
                typeof data.title === "string" ? data.title : typeof node.label === "string" ? node.label : "",
                typeof data.subtitle === "string" ? data.subtitle : "",
                ...legacyLines,
              ]
                .filter(Boolean)
                .join("\n"),
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

  const mergedNodes = [...payload.nodes, ...(Array.isArray(payload.events) ? payload.events : [])];

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

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
    : false;
}
