import { MarkerType, type Edge, type Node, type Viewport, type XYPosition } from "@xyflow/react";

export type ShapeNodeKind = "rectangle" | "rounded" | "ellipse" | "diamond";

export type ShapeHandleId = "top" | "right" | "bottom" | "left";

export type LineNodeKind = "solid" | "dashed" | "arrow";

export type LineAnchor = {
  nodeId: string;
  handle: ShapeHandleId;
};

export const SHAPE_NODE_DIMENSIONS = {
  rectangle: { width: 220, height: 118 },
  rounded: { width: 228, height: 124 },
  ellipse: { width: 232, height: 132 },
  diamond: { width: 176, height: 176 },
} satisfies Record<ShapeNodeKind, { width: number; height: number }>;

export const DIAMOND_VERTEX_INSET_PERCENT = 0;

export function isWideCharacter(char: string) {
  const codePoint = char.codePointAt(0) ?? 0;

  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

export function getTextVisualUnits(text: string) {
  return [...text].reduce((total, char) => {
    if (char === " ") {
      return total + 0.35;
    }

    if (/[A-Z]/.test(char)) {
      return total + 0.72;
    }

    if (/[a-z0-9]/.test(char)) {
      return total + 0.62;
    }

    if (/[.,:;|/\()[\]{}'"`_-]/.test(char)) {
      return total + 0.4;
    }

    return total + (isWideCharacter(char) ? 1 : 0.88);
  }, 0);
}

export function getShapeHandleInset(
  kind: ShapeNodeKind,
  width: number,
  height: number,
  handle?: ShapeHandleId,
) {
  if (kind !== "diamond") {
    return 0;
  }

  const horizontalInset = width * (DIAMOND_VERTEX_INSET_PERCENT / 100);
  const verticalInset = height * (DIAMOND_VERTEX_INSET_PERCENT / 100);

  if (handle === "left" || handle === "right") {
    return horizontalInset;
  }

  if (handle === "top" || handle === "bottom") {
    return verticalInset;
  }

  return Math.min(horizontalInset, verticalInset);
}

export function getShapeHandlePoint(
  frame: { x: number; y: number; width: number; height: number; kind: ShapeNodeKind },
  handle: ShapeHandleId,
): XYPosition {
  const inset = getShapeHandleInset(frame.kind, frame.width, frame.height, handle);

  switch (handle) {
    case "top":
      return { x: frame.x + frame.width / 2, y: frame.y + inset };
    case "right":
      return { x: frame.x + frame.width - inset, y: frame.y + frame.height / 2 };
    case "bottom":
      return { x: frame.x + frame.width / 2, y: frame.y + frame.height - inset };
    case "left":
      return { x: frame.x + inset, y: frame.y + frame.height / 2 };
    default:
      return { x: frame.x, y: frame.y };
  }
}

export const DEFAULT_LINE_WIDTH = 220;
export const DEFAULT_LINE_HEIGHT = 56;

export type ShapeNodeData = {
  kind: ShapeNodeKind;
  text: string;
  imageUrl?: string;
  fillColor?: string;
  strokeColor?: string;
  textColor?: string;
};

export type LineNodeData = {
  kind: LineNodeKind;
  text: string;
  color?: string;
  anchorStart?: LineAnchor;
  anchorEnd?: LineAnchor;
};

export type EdgePathStyle = "smoothstep" | "straight" | "step";

export type EdgeMarkerStyle = "arrow" | "none";

export type EdgeLabelOffset = {
  x: number;
  y: number;
};

export type EdgeRoutePoint = {
  x: number;
  y: number;
};

export type EdgeRouteMode = "inner" | "full";

export type EdgeLabelPlacementMode = "auto" | "manual";

export type RelationEdgeData = {
  pathStyle: EdgePathStyle;
  dashed: boolean;
  marker: EdgeMarkerStyle;
  color?: string;
  labelOffset?: EdgeLabelOffset;
  labelAnchorPosition?: number;
  labelPlacementMode?: EdgeLabelPlacementMode;
  manualRoute?: EdgeRoutePoint[];
  manualRouteMode?: EdgeRouteMode;
};

export type ShapeNode = Node<ShapeNodeData, "shapeNode">;

export type LineNode = Node<LineNodeData, "lineNode">;

export type AppNode = ShapeNode | LineNode;

export type AppEdge = Edge<RelationEdgeData, "relationEdge">;

export type GraphDocument = {
  nodes: AppNode[];
  edges: AppEdge[];
  viewport: Viewport;
};

export const defaultViewport: Viewport = {
  x: 120,
  y: 60,
  zoom: 0.9,
};

const DEFAULT_EDGE_COLOR = "#64748b";
const DEFAULT_SHAPE_FILL = "#ffffff";
const DEFAULT_SHAPE_STROKE = "#cbd5e1";
const DEFAULT_TEXT_COLOR = "#0f172a";

function getFallbackPosition(index: number): XYPosition {
  return { x: 160 + index * 48, y: 140 + index * 32 };
}

export function isShapeKind(value: unknown): value is ShapeNodeKind {
  return value === "rectangle" || value === "rounded" || value === "ellipse" || value === "diamond";
}

export function isLineKind(value: unknown): value is LineNodeKind {
  return value === "solid" || value === "dashed" || value === "arrow";
}

export function isShapeHandleId(value: unknown): value is ShapeHandleId {
  return value === "top" || value === "right" || value === "bottom" || value === "left";
}

export function isLineAnchor(value: unknown): value is LineAnchor {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { nodeId?: unknown }).nodeId === "string" &&
      isShapeHandleId((value as { handle?: unknown }).handle),
  );
}

export function isEdgeLabelOffset(value: unknown): value is EdgeLabelOffset {
  return Boolean(
    value &&
      typeof value === "object" &&
      Number.isFinite((value as { x?: unknown }).x) &&
      Number.isFinite((value as { y?: unknown }).y),
  );
}

export function isEdgeLabelAnchorPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isEdgeLabelPlacementMode(value: unknown): value is EdgeLabelPlacementMode {
  return value === "auto" || value === "manual";
}

export function isEdgeRoutePoint(value: unknown): value is EdgeRoutePoint {
  return Boolean(
    value &&
      typeof value === "object" &&
      Number.isFinite((value as { x?: unknown }).x) &&
      Number.isFinite((value as { y?: unknown }).y),
  );
}

export function isEdgeRoutePoints(value: unknown): value is EdgeRoutePoint[] {
  return Array.isArray(value) && value.every(isEdgeRoutePoint);
}

export function isEdgeRouteMode(value: unknown): value is EdgeRouteMode {
  return value === "inner" || value === "full";
}

export function buildEdgeStyle({
  dashed = false,
  color = DEFAULT_EDGE_COLOR,
}: {
  dashed?: boolean;
  color?: string;
} = {}) {
  return {
    stroke: color,
    strokeWidth: 2.25,
    strokeDasharray: dashed ? "8 6" : undefined,
    strokeLinecap: "round" as const,
  };
}

export function buildMarkerEnd(marker: EdgeMarkerStyle, color = DEFAULT_EDGE_COLOR) {
  return marker === "arrow"
    ? {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      }
    : undefined;
}

export function createShapeNode(partial: Partial<ShapeNode> = {}, index = 0): ShapeNode {
  const data = (partial.data ?? {}) as Partial<ShapeNodeData>;
  const kind = isShapeKind(data.kind) ? data.kind : "rectangle";
  const defaultSize = SHAPE_NODE_DIMENSIONS[kind];
  const width =
    typeof partial.width === "number"
      ? partial.width
      : typeof partial.initialWidth === "number"
        ? partial.initialWidth
        : defaultSize.width;
  const height =
    typeof partial.height === "number"
      ? partial.height
      : typeof partial.initialHeight === "number"
        ? partial.initialHeight
        : defaultSize.height;

  return {
    id: partial.id ?? `shape-${Date.now()}-${index}`,
    type: "shapeNode",
    position:
      partial.position &&
      typeof partial.position.x === "number" &&
      typeof partial.position.y === "number"
        ? partial.position
        : getFallbackPosition(index),
    data: {
      kind,
      text: typeof data.text === "string" ? data.text : "",
      imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
      fillColor: typeof data.fillColor === "string" ? data.fillColor : DEFAULT_SHAPE_FILL,
      strokeColor: typeof data.strokeColor === "string" ? data.strokeColor : DEFAULT_SHAPE_STROKE,
      textColor: typeof data.textColor === "string" ? data.textColor : DEFAULT_TEXT_COLOR,
    },
    width,
    height,
    initialWidth: width,
    initialHeight: height,
  };
}

export function createLineNode(partial: Partial<LineNode> = {}, index = 0): LineNode {
  const data = (partial.data ?? {}) as Partial<LineNodeData>;
  const width =
    typeof partial.width === "number"
      ? partial.width
      : typeof partial.initialWidth === "number"
        ? partial.initialWidth
        : DEFAULT_LINE_WIDTH;
  const height =
    typeof partial.height === "number"
      ? partial.height
      : typeof partial.initialHeight === "number"
        ? partial.initialHeight
        : DEFAULT_LINE_HEIGHT;

  return {
    id: partial.id ?? `line-${Date.now()}-${index}`,
    type: "lineNode",
    position:
      partial.position &&
      typeof partial.position.x === "number" &&
      typeof partial.position.y === "number"
        ? partial.position
        : getFallbackPosition(index),
    data: {
      kind: isLineKind(data.kind) ? data.kind : "solid",
      text: typeof data.text === "string" ? data.text : "",
      color: typeof data.color === "string" ? data.color : DEFAULT_EDGE_COLOR,
      anchorStart: isLineAnchor(data.anchorStart) ? data.anchorStart : undefined,
      anchorEnd: isLineAnchor(data.anchorEnd) ? data.anchorEnd : undefined,
    },
    width,
    height,
    initialWidth: width,
    initialHeight: height,
    draggable: true,
    selectable: true,
    dragHandle: ".line-node-drag-handle",
  };
}

export function createRelationEdge(partial: Partial<AppEdge> = {}, index = 0): AppEdge {
  const data = (partial.data ?? {}) as Partial<RelationEdgeData>;
  const color = data.color ?? DEFAULT_EDGE_COLOR;
  const dashed = data.dashed ?? false;
  const marker = data.marker ?? "arrow";
  const pathStyle = data.pathStyle ?? "smoothstep";
  const labelOffset = isEdgeLabelOffset(data.labelOffset) ? data.labelOffset : undefined;
  const labelAnchorPosition = isEdgeLabelAnchorPosition(data.labelAnchorPosition)
    ? Math.min(Math.max(data.labelAnchorPosition, 0), 1)
    : undefined;
  const labelPlacementMode = isEdgeLabelPlacementMode(data.labelPlacementMode) ? data.labelPlacementMode : undefined;
  const manualRoute = isEdgeRoutePoints(data.manualRoute) ? data.manualRoute : undefined;
  const manualRouteMode = isEdgeRouteMode(data.manualRouteMode) ? data.manualRouteMode : undefined;

  return {
    ...partial,
    id: partial.id ?? `edge-${Date.now()}-${index}`,
    type: "relationEdge",
    source: partial.source ?? "",
    target: partial.target ?? "",
    sourceHandle: partial.sourceHandle,
    targetHandle: partial.targetHandle,
    label: typeof partial.label === "string" ? partial.label : "",
    data: {
      pathStyle,
      dashed,
      marker,
      color,
      labelOffset,
      labelAnchorPosition,
      labelPlacementMode,
      manualRoute,
      manualRouteMode,
    },
    style: buildEdgeStyle({ dashed, color }),
    markerEnd: buildMarkerEnd(marker, color),
  };
}

const sampleGraphDocument: GraphDocument = {
  viewport: defaultViewport,
  nodes: [
    createShapeNode(
      {
        id: "shape-1",
        position: { x: 120, y: 160 },
        data: {
          kind: "rounded",
          text: "线索入口\n支持图片与多行说明",
        },
      },
      0,
    ),
    createShapeNode(
      {
        id: "shape-2",
        position: { x: 480, y: 220 },
        data: {
          kind: "ellipse",
          text: "处理中",
        },
      },
      1,
    ),
    createShapeNode(
      {
        id: "shape-3",
        position: { x: 840, y: 160 },
        data: {
          kind: "diamond",
          text: "结果",
        },
      },
      2,
    ),
  ],
  edges: [
    createRelationEdge(
      {
        id: "edge-1",
        source: "shape-1",
        target: "shape-2",
        sourceHandle: "source-right",
        targetHandle: "target-left",
        label: "默认连线",
        data: {
          pathStyle: "smoothstep",
          dashed: false,
          marker: "arrow",
        },
      },
      0,
    ),
    createRelationEdge(
      {
        id: "edge-2",
        source: "shape-2",
        target: "shape-3",
        sourceHandle: "source-right",
        targetHandle: "target-left",
        label: "双击标签也可编辑",
        data: {
          pathStyle: "straight",
          dashed: true,
          marker: "arrow",
        },
      },
      1,
    ),
  ],
};

export function createSampleGraphDocument(): GraphDocument {
  return structuredClone(sampleGraphDocument);
}

export function stringifyGraphDocument(document: GraphDocument) {
  return JSON.stringify(document, null, 2);
}
