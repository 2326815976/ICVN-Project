import type { ElkEdgeSection, ElkExtendedEdge, ElkNode, ElkPoint, LayoutOptions } from "elkjs/lib/elk-api";

import {
  SHAPE_NODE_DIMENSIONS,
  createRelationEdge,
  defaultViewport,
  getShapeHandlePoint,
  getTextVisualUnits,
  type AppEdge,
  type AppNode,
  type GraphDocument,
  type ShapeHandleId,
  type ShapeNodeKind,
} from "./sample-graph";

const GRAPH_LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.interactive": "true",
  "elk.padding": "[top=96,left=96,bottom=96,right=96]",
  "elk.spacing.nodeNode": "126",
  "elk.spacing.edgeNode": "96",
  "elk.spacing.edgeEdge": "60",
  "elk.spacing.componentComponent": "176",
  "elk.spacing.labelNode": "18",
  "elk.spacing.edgeLabel": "18",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
  "elk.layered.spacing.nodeNodeBetweenLayers": "284",
  "elk.layered.spacing.edgeNodeBetweenLayers": "152",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "84",
};

type ShapeGraphNode = Extract<AppNode, { type: "shapeNode" }>;

type LayoutNodeFrame = {
  kind: ShapeNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutEdgeRouteFrame = {
  sourceHandle: string;
  targetHandle: string;
  manualRoute?: Array<{ x: number; y: number }>;
};

type LayoutGraphFrame = {
  nodeMap: Map<string, LayoutNodeFrame>;
  edgeRouteMap: Map<string, LayoutEdgeRouteFrame>;
};

const HANDLE_VECTORS: Record<ShapeHandleId, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const HANDLE_SIDES: ShapeHandleId[] = ["top", "right", "bottom", "left"];

const AUTO_LAYOUT_BASE_DIMENSIONS = {
  rectangle: { width: 120, height: 80 },
  rounded: { width: 128, height: 88 },
  ellipse: { width: 144, height: 96 },
  diamond: { width: 132, height: 132 },
} satisfies Record<ShapeNodeKind, { width: number; height: number }>;

function isShapeGraphNode(node: AppNode): node is ShapeGraphNode {
  return node.type === "shapeNode";
}

function getNodeWidth(node: ShapeGraphNode) {
  return typeof node.width === "number"
    ? node.width
    : typeof node.initialWidth === "number"
      ? node.initialWidth
      : SHAPE_NODE_DIMENSIONS[node.data.kind].width;
}

function getNodeHeight(node: ShapeGraphNode) {
  return typeof node.height === "number"
    ? node.height
    : typeof node.initialHeight === "number"
      ? node.initialHeight
      : SHAPE_NODE_DIMENSIONS[node.data.kind].height;
}

function estimateNodeLabelSize(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const longestLineUnits = lines.reduce((max, line) => Math.max(max, getTextVisualUnits(line)), 0);
  const lineCount = Math.max(lines.length, 1);

  return {
    width: clamp(Math.ceil(longestLineUnits * 14 + 24), 56, 300),
    height: clamp(lineCount * 24 + 8, 32, 160),
  };
}

function getLayoutNodeMinimumSize(node: ShapeGraphNode) {
  const baseSize = AUTO_LAYOUT_BASE_DIMENSIONS[node.data.kind];
  const labelSize = estimateNodeLabelSize(node.data.text ?? "");
  const hasImage = Boolean(node.data.imageUrl);
  const imageHeight = hasImage ? 76 : 0;
  let minWidth = Math.max(baseSize.width, labelSize.width + 30);
  let minHeight = Math.max(baseSize.height, labelSize.height + 24 + imageHeight);

  if (node.data.kind === "rounded") {
    minWidth = Math.max(minWidth, labelSize.width + 36);
    minHeight = Math.max(minHeight, labelSize.height + 30 + imageHeight);
  }

  if (node.data.kind === "ellipse") {
    minWidth = Math.max(baseSize.width, labelSize.width + 52);
    minHeight = Math.max(baseSize.height, labelSize.height + 32 + imageHeight);
  }

  if (node.data.kind === "diamond") {
    const contentSpan = Math.max(labelSize.width + 40, labelSize.height + 40 + imageHeight);
    const uniformSize = Math.max(baseSize.width, Math.ceil(contentSpan * 1.08));
    minWidth = uniformSize;
    minHeight = uniformSize;
  }

  return {
    width: Math.round(minWidth),
    height: Math.round(minHeight),
    label: labelSize,
  };
}

function getDirectionalPreferredHandleSideFromFrame(
  sourceFrame: LayoutNodeFrame,
  targetFrame: LayoutNodeFrame,
): ShapeHandleId {
  const sourceCenterX = sourceFrame.x + sourceFrame.width / 2;
  const sourceCenterY = sourceFrame.y + sourceFrame.height / 2;
  const targetCenterX = targetFrame.x + targetFrame.width / 2;
  const targetCenterY = targetFrame.y + targetFrame.height / 2;
  const deltaX = targetCenterX - sourceCenterX;
  const deltaY = targetCenterY - sourceCenterY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  if (absDeltaX >= 40 || absDeltaX >= absDeltaY * 0.55) {
    return deltaX >= 0 ? "right" : "left";
  }

  return deltaY >= 0 ? "bottom" : "top";
}

function scoreHandlePairFromFrame(
  sourceFrame: LayoutNodeFrame,
  targetFrame: LayoutNodeFrame,
  sourceSide: ShapeHandleId,
  targetSide: ShapeHandleId,
) {
  const sourcePoint = getHandleCenterFromFrame(sourceFrame, sourceSide);
  const targetPoint = getHandleCenterFromFrame(targetFrame, targetSide);
  const deltaX = targetPoint.x - sourcePoint.x;
  const deltaY = targetPoint.y - sourcePoint.y;
  const euclideanDistance = Math.max(Math.hypot(deltaX, deltaY), 1);
  const manhattanDistance = Math.abs(deltaX) + Math.abs(deltaY);
  const sourceVector = HANDLE_VECTORS[sourceSide];
  const targetVector = HANDLE_VECTORS[targetSide];
  const sourceDirectionScore = (deltaX * sourceVector.x + deltaY * sourceVector.y) / euclideanDistance;
  const targetDirectionScore = (-deltaX * targetVector.x + -deltaY * targetVector.y) / euclideanDistance;
  const horizontalBias = Math.abs(deltaX) - Math.abs(deltaY);
  const isSourceHorizontal = sourceSide === "left" || sourceSide === "right";
  const isTargetHorizontal = targetSide === "left" || targetSide === "right";
  let axisBonus = 0;
  let pairBonus = 0;

  if (horizontalBias >= 0) {
    axisBonus += isSourceHorizontal ? 18 : 0;
    axisBonus += isTargetHorizontal ? 18 : 0;
  } else {
    axisBonus += !isSourceHorizontal ? 18 : 0;
    axisBonus += !isTargetHorizontal ? 18 : 0;
  }

  if (deltaX >= 0 && sourceSide === "right" && targetSide === "left") {
    pairBonus += 42;
  }
  if (deltaX < 0 && sourceSide === "left" && targetSide === "right") {
    pairBonus += 42;
  }
  if (deltaY >= 0 && sourceSide === "bottom" && targetSide === "top") {
    pairBonus += 42;
  }
  if (deltaY < 0 && sourceSide === "top" && targetSide === "bottom") {
    pairBonus += 42;
  }

  const turnPenalty = isSourceHorizontal !== isTargetHorizontal ? 12 : 0;
  const sameSidePenalty = sourceSide === targetSide ? 18 : 0;

  return (
    sourceDirectionScore * 120 +
    targetDirectionScore * 120 +
    axisBonus +
    pairBonus -
    turnPenalty -
    sameSidePenalty -
    manhattanDistance * 0.03
  );
}

function getPreferredHandlePairFromFrame(sourceFrame: LayoutNodeFrame, targetFrame: LayoutNodeFrame) {
  const fallbackSourceSide = getDirectionalPreferredHandleSideFromFrame(sourceFrame, targetFrame);
  const fallbackTargetSide = getDirectionalPreferredHandleSideFromFrame(targetFrame, sourceFrame);
  let bestCandidate = {
    sourceSide: fallbackSourceSide,
    targetSide: fallbackTargetSide,
    score: Number.NEGATIVE_INFINITY,
  };

  for (const sourceSide of HANDLE_SIDES) {
    for (const targetSide of HANDLE_SIDES) {
      const score =
        scoreHandlePairFromFrame(sourceFrame, targetFrame, sourceSide, targetSide) +
        (sourceSide === fallbackSourceSide ? 0.8 : 0) +
        (targetSide === fallbackTargetSide ? 0.8 : 0);

      if (score > bestCandidate.score) {
        bestCandidate = {
          sourceSide,
          targetSide,
          score,
        };
      }
    }
  }

  return bestCandidate;
}


function buildHandleId(prefix: "source" | "target", side: ShapeHandleId) {
  return `${prefix}-${side}`;
}

function getSortedShapeNodes(nodes: ShapeGraphNode[]) {
  return [...nodes].sort((left, right) => {
    if (left.position.x !== right.position.x) {
      return left.position.x - right.position.x;
    }

    return left.position.y - right.position.y;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const COMPONENT_PACK_GAP_X = 144;
const COMPONENT_PACK_GAP_Y = 120;
const COMPONENT_PACK_PADDING = 72;

function compareNodePosition(left: { x: number; y: number }, right: { x: number; y: number }) {
  if (left.x !== right.x) {
    return left.x - right.x;
  }

  return left.y - right.y;
}

function getConnectedShapeComponents(nodes: ShapeGraphNode[], edges: AppEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));

  for (const node of nodes) {
    adjacency.set(node.id, new Set<string>());
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target) || edge.source === edge.target) {
      continue;
    }

    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  const sortedNodes = getSortedShapeNodes(nodes);

  for (const node of sortedNodes) {
    if (visited.has(node.id)) {
      continue;
    }

    const stack = [node.id];
    const component: string[] = [];
    visited.add(node.id);

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId) {
        continue;
      }

      component.push(currentId);

      for (const neighborId of adjacency.get(currentId) ?? []) {
        if (visited.has(neighborId)) {
          continue;
        }

        visited.add(neighborId);
        stack.push(neighborId);
      }
    }

    component.sort((leftId, rightId) => {
      const leftNode = nodeById.get(leftId);
      const rightNode = nodeById.get(rightId);

      if (!leftNode || !rightNode) {
        return 0;
      }

      return compareNodePosition(leftNode.position, rightNode.position);
    });

    components.push(component);
  }

  return components;
}

type NodeMapBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

function getNodeMapBounds(nodeMap: Map<string, LayoutNodeFrame>, nodeIds?: Iterable<string>): NodeMapBounds {
  const frames = (nodeIds ? [...nodeIds].map((nodeId) => nodeMap.get(nodeId)) : [...nodeMap.values()]).filter(
    (frame): frame is LayoutNodeFrame => Boolean(frame),
  );

  if (frames.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
  }

  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function translateLayoutNodeMap(nodeMap: Map<string, LayoutNodeFrame>, offsetX: number, offsetY: number) {
  return new Map<string, LayoutNodeFrame>(
    [...nodeMap.entries()].map(([nodeId, frame]) => [
      nodeId,
      {
        ...frame,
        x: Math.round(frame.x + offsetX),
        y: Math.round(frame.y + offsetY),
      },
    ]),
  );
}

function translateEdgeRouteMap(
  edgeRouteMap: Map<string, LayoutEdgeRouteFrame>,
  offsetX: number,
  offsetY: number,
) {
  return new Map<string, LayoutEdgeRouteFrame>(
    [...edgeRouteMap.entries()].map(([edgeId, frame]) => [
      edgeId,
      {
        ...frame,
        manualRoute: frame.manualRoute?.map((point) => ({
          x: Math.round(point.x + offsetX),
          y: Math.round(point.y + offsetY),
        })),
      },
    ]),
  );
}

function normalizeLayoutNodeMap(
  nodeMap: Map<string, LayoutNodeFrame>,
  nodes: ShapeGraphNode[],
  edges: AppEdge[],
) {
  const clonedNodeMap = new Map<string, LayoutNodeFrame>(
    [...nodeMap.entries()].map(([nodeId, frame]) => [nodeId, { ...frame }]),
  );
  const componentIdsList = getConnectedShapeComponents(nodes, edges);

  if (componentIdsList.length === 0) {
    return clonedNodeMap;
  }

  const componentFrames = componentIdsList
    .map((componentIds) => {
      const componentNodeMap = new Map<string, LayoutNodeFrame>(
        componentIds
          .map((nodeId) => {
            const frame = clonedNodeMap.get(nodeId);
            return frame ? ([nodeId, { ...frame }] as const) : null;
          })
          .filter((entry): entry is readonly [string, LayoutNodeFrame] => Boolean(entry)),
      );
      const componentBounds = getNodeMapBounds(componentNodeMap);
      const normalizedNodeMap = translateLayoutNodeMap(componentNodeMap, -componentBounds.minX, -componentBounds.minY);
      const bounds = getNodeMapBounds(normalizedNodeMap);
      const componentEdgeCount = edges.filter(
        (edge) => componentNodeMap.has(edge.source) && componentNodeMap.has(edge.target) && edge.source !== edge.target,
      ).length;

      return {
        componentIds,
        nodeMap: normalizedNodeMap,
        bounds,
        area: Math.max(bounds.width * bounds.height, 1),
        edgeCount: componentEdgeCount,
      };
    })
    .sort((left, right) => {
      if (left.edgeCount !== right.edgeCount) {
        return right.edgeCount - left.edgeCount;
      }

      if (left.area !== right.area) {
        return right.area - left.area;
      }

      return right.componentIds.length - left.componentIds.length;
    });

  const totalArea = componentFrames.reduce((sum, component) => sum + component.area, 0);
  const targetRowWidth = clamp(Math.round(Math.sqrt(totalArea) * 1.4), 900, 2600);
  const maxPreferredRowCount = Math.max(1, Math.ceil(Math.sqrt(componentFrames.length)));
  const rows: Array<{
    components: Array<(typeof componentFrames)[number]>;
    width: number;
    height: number;
  }> = [];

  for (const component of componentFrames) {
    let bestRowIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const nextWidth = row.width === 0 ? component.bounds.width : row.width + COMPONENT_PACK_GAP_X + component.bounds.width;
      const nextHeight = Math.max(row.height, component.bounds.height);
      const overflow = Math.max(0, nextWidth - targetRowWidth);
      const remaining = Math.max(0, targetRowWidth - nextWidth);
      const heightGrowth = nextHeight - row.height;
      const canPlaceInRow = nextWidth <= targetRowWidth || rows.length >= maxPreferredRowCount;

      if (!canPlaceInRow) {
        continue;
      }

      const score = overflow * 3 + remaining * 0.35 + heightGrowth * 2;
      if (score < bestScore) {
        bestScore = score;
        bestRowIndex = rowIndex;
      }
    }

    if (bestRowIndex === -1) {
      rows.push({
        components: [component],
        width: component.bounds.width,
        height: component.bounds.height,
      });
      continue;
    }

    const row = rows[bestRowIndex];
    row.components.push(component);
    row.width += (row.width > 0 ? COMPONENT_PACK_GAP_X : 0) + component.bounds.width;
    row.height = Math.max(row.height, component.bounds.height);
  }

  const packedNodeMap = new Map<string, LayoutNodeFrame>();
  const maxRowWidth = rows.reduce((max, row) => Math.max(max, row.width), 0);
  let cursorY = COMPONENT_PACK_PADDING;

  for (const row of rows) {
    let cursorX = COMPONENT_PACK_PADDING + Math.max(0, (maxRowWidth - row.width) / 2);

    for (const component of row.components) {
      const offsetY = cursorY + Math.max(0, (row.height - component.bounds.height) / 2);

      for (const [nodeId, frame] of component.nodeMap.entries()) {
        packedNodeMap.set(nodeId, {
          ...frame,
          x: Math.round(frame.x + cursorX),
          y: Math.round(frame.y + offsetY),
        });
      }

      cursorX += component.bounds.width + COMPONENT_PACK_GAP_X;
    }

    cursorY += row.height + COMPONENT_PACK_GAP_Y;
  }

  return packedNodeMap;
}


function getHandleCenterFromFrame(frame: LayoutNodeFrame, side: ShapeHandleId) {
  return getShapeHandlePoint(frame, side);
}

function isPointInsideRect(point: { x: number; y: number }, rect: { left: number; top: number; right: number; bottom: number }) {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function segmentIntersectsRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
) {
  if (isPointInsideRect(start, rect) || isPointInsideRect(end, rect)) {
    return true;
  }

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number) => {
    if (p === 0) {
      return q >= 0;
    }

    const ratio = q / p;

    if (p < 0) {
      if (ratio > t1) {
        return false;
      }

      if (ratio > t0) {
        t0 = ratio;
      }

      return true;
    }

    if (ratio < t0) {
      return false;
    }

    if (ratio < t1) {
      t1 = ratio;
    }

    return true;
  };

  return (
    clip(-deltaX, start.x - rect.left) &&
    clip(deltaX, rect.right - start.x) &&
    clip(-deltaY, start.y - rect.top) &&
    clip(deltaY, rect.bottom - start.y) &&
    t0 <= t1
  );
}

function shouldUseStraightLayoutEdge(
  edge: AppEdge,
  sourceFrame: LayoutNodeFrame,
  targetFrame: LayoutNodeFrame,
  sourceSide: ShapeHandleId,
  targetSide: ShapeHandleId,
  nodeMap: Map<string, LayoutNodeFrame>,
  edges: AppEdge[],
) {
  const pairEdgeCount = edges.filter(
    (candidate) =>
      (candidate.source === edge.source && candidate.target === edge.target) ||
      (candidate.source === edge.target && candidate.target === edge.source),
  ).length;

  if (pairEdgeCount > 1) {
    return false;
  }

  const start = getHandleCenterFromFrame(sourceFrame, sourceSide);
  const end = getHandleCenterFromFrame(targetFrame, targetSide);
  const obstaclePadding = 20;

  for (const [nodeId, frame] of nodeMap.entries()) {
    if (nodeId === edge.source || nodeId === edge.target) {
      continue;
    }

    const expandedRect = {
      left: frame.x - obstaclePadding,
      top: frame.y - obstaclePadding,
      right: frame.x + frame.width + obstaclePadding,
      bottom: frame.y + frame.height + obstaclePadding,
    };

    if (segmentIntersectsRect(start, end, expandedRect)) {
      return false;
    }
  }

  return true;
}

type Point = {
  x: number;
  y: number;
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type LabelPlacement = {
  anchorX: number;
  anchorY: number;
  bubbleX: number;
  bubbleY: number;
  connectorLength: number;
  connectorAngle: number;
};

type LabelSize = {
  width: number;
  height: number;
  area: number;
};

type RouteSegment = {
  start: Point;
  end: Point;
  length: number;
  isHorizontal: boolean;
  cumulativeStart: number;
  cumulativeEnd: number;
};

type PolylineProjection = {
  x: number;
  y: number;
  progress: number;
  segment: RouteSegment;
  segmentRatio: number;
  distanceFromSegmentStart: number;
};

type EdgePreviewFrame = {
  edge: AppEdge;
  labelText: string;
  labelSize: LabelSize;
  points: Point[];
  routeLength: number;
  nodeObstacleRects: Rect[];
  routeCorridors: Rect[];
  laneOffset: number;
  isManualLabel: boolean;
};

type OptimizedEdgeLabelPlacement = {
  labelOffset: { x: number; y: number };
  labelAnchorPosition: number;
  labelPlacementMode: "auto";
};

function getEdgeLabelText(label: string) {
  const trimmed = label.trim();
  return trimmed.length > 0 ? label : "??????????";
}

function hasMeaningfulLabelOffset(value: NonNullable<AppEdge["data"]>["labelOffset"]) {
  return Boolean(value && (Math.abs(value.x) > 0.5 || Math.abs(value.y) > 0.5));
}

function isManualLabelPlacement(edge: AppEdge) {
  if (edge.data?.labelPlacementMode === "manual") {
    return true;
  }

  if (edge.data?.labelPlacementMode === "auto") {
    return false;
  }

  return hasMeaningfulLabelOffset(edge.data?.labelOffset) || typeof edge.data?.labelAnchorPosition === "number";
}

function getStableLabelNudge(value: string) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }

  return ((hash % 5) - 2) * 12;
}

function estimateEdgeLabelSize(labelText: string): LabelSize {
  const normalizedLabel = getEdgeLabelText(labelText);
  const lines = normalizedLabel
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const longestLineUnits = lines.reduce((max, line) => Math.max(max, getTextVisualUnits(line)), 0);
  const lineCount = Math.max(lines.length, 1);
  const width = clamp(Math.ceil(longestLineUnits * 14 + 60), 132, 280);
  const height = clamp(lineCount * 24 + 18, 44, 132);

  return {
    width,
    height,
    area: width * height,
  };
}

function createRectFromFrame(frame: LayoutNodeFrame): Rect {
  return {
    left: frame.x,
    top: frame.y,
    right: frame.x + frame.width,
    bottom: frame.y + frame.height,
  };
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };
}

function createLabelPlacement(anchorX: number, anchorY: number, offsetX: number, offsetY: number): LabelPlacement {
  const distance = Math.hypot(offsetX, offsetY);

  return {
    anchorX,
    anchorY,
    bubbleX: anchorX + offsetX,
    bubbleY: anchorY + offsetY,
    connectorLength: Math.max(0, distance - 10),
    connectorAngle: (Math.atan2(offsetY, offsetX) * 180) / Math.PI,
  };
}

function applyLabelOffset(placement: LabelPlacement, offsetX = 0, offsetY = 0): LabelPlacement {
  return createLabelPlacement(
    placement.anchorX,
    placement.anchorY,
    placement.bubbleX - placement.anchorX + offsetX,
    placement.bubbleY - placement.anchorY + offsetY,
  );
}

function createLabelRect(centerX: number, centerY: number, size: LabelSize): Rect {
  return {
    left: centerX - size.width / 2,
    top: centerY - size.height / 2,
    right: centerX + size.width / 2,
    bottom: centerY + size.height / 2,
  };
}

function getRectClearance(first: Rect, second: Rect) {
  const dx = Math.max(second.left - first.right, first.left - second.right, 0);
  const dy = Math.max(second.top - first.bottom, first.top - second.bottom, 0);

  if (dx === 0 && dy === 0) {
    const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
    const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
    return -Math.min(overlapX, overlapY);
  }

  return Math.hypot(dx, dy);
}

function getMinimumRectClearance(rect: Rect, obstacles: Rect[]) {
  if (obstacles.length === 0) {
    return 96;
  }

  return obstacles.reduce((minimum, obstacle) => Math.min(minimum, getRectClearance(rect, obstacle)), Number.POSITIVE_INFINITY);
}

function buildRouteSegments(points: Point[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let cumulativeLength = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const length = Math.hypot(deltaX, deltaY);

    if (length <= 0.5) {
      continue;
    }

    segments.push({
      start,
      end,
      length,
      isHorizontal: Math.abs(deltaX) >= Math.abs(deltaY),
      cumulativeStart: cumulativeLength,
      cumulativeEnd: cumulativeLength + length,
    });

    cumulativeLength += length;
  }

  return segments;
}

function getSegmentAnchor(segment: RouteSegment, ratio: number): Point {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  };
}

function getPolylinePointAtProgress(points: Point[], progress: number): PolylineProjection | null {
  const routeSegments = buildRouteSegments(points);
  const totalLength = routeSegments[routeSegments.length - 1]?.cumulativeEnd ?? 0;

  if (routeSegments.length === 0 || totalLength <= 0) {
    return null;
  }

  const normalizedProgress = clamp(progress, 0, 1);
  const targetDistance = totalLength * normalizedProgress;
  const segment =
    routeSegments.find((item) => targetDistance >= item.cumulativeStart && targetDistance <= item.cumulativeEnd) ??
    routeSegments[routeSegments.length - 1];
  const distanceFromSegmentStart = clamp(targetDistance - segment.cumulativeStart, 0, segment.length);
  const segmentRatio = segment.length <= 0 ? 0 : distanceFromSegmentStart / segment.length;
  const point = getSegmentAnchor(segment, segmentRatio);

  return {
    x: point.x,
    y: point.y,
    progress: totalLength <= 0 ? 0 : targetDistance / totalLength,
    segment,
    segmentRatio,
    distanceFromSegmentStart,
  };
}

function scoreBaseLabelPlacement(
  placement: LabelPlacement,
  size: LabelSize,
  obstacleRects: Rect[],
  segmentLength: number,
  prefersOutwardSide: boolean,
  endClearance: number,
) {
  const labelRect = createLabelRect(placement.bubbleX, placement.bubbleY, size);
  const minClearance = getMinimumRectClearance(labelRect, obstacleRects);
  const safeClearance = Number.isFinite(minClearance) ? minClearance : 72;
  const overlapPenalty = safeClearance < 0 ? Math.abs(safeClearance) * 96 : 0;
  const nearPenalty = safeClearance >= 0 && safeClearance < 22 ? (22 - safeClearance) * 14 : 0;
  const endPenalty = endClearance < 32 ? (32 - endClearance) * 8 : 0;

  return (
    safeClearance * 18 +
    segmentLength * 0.16 +
    Math.min(endClearance, 88) * 0.55 +
    (prefersOutwardSide ? 22 : 0) -
    placement.connectorLength * 0.24 -
    overlapPenalty -
    nearPenalty -
    endPenalty
  );
}

function chooseBestLabelPlacement(
  points: Point[],
  options: { edgeId: string; labelText: string; obstacleRects: Rect[]; laneOffset: number; anchorProgress?: number },
): LabelPlacement {
  const labelSize = estimateEdgeLabelSize(options.labelText);
  const centerPoint = points.reduce(
    (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
    { x: 0, y: 0 },
  );
  const graphCenter = {
    x: centerPoint.x / Math.max(points.length, 1),
    y: centerPoint.y / Math.max(points.length, 1),
  };
  const stableAxisNudge = getStableLabelNudge(options.edgeId) * 0.7;

  const chooseForProjection = (projection: PolylineProjection) => {
    const outwardSide = projection.segment.isHorizontal
      ? projection.y <= graphCenter.y
        ? -1
        : 1
      : projection.x <= graphCenter.x
        ? -1
        : 1;
    const endClearance = Math.min(
      projection.distanceFromSegmentStart,
      projection.segment.length - projection.distanceFromSegmentStart,
    );
    let bestPlacement: LabelPlacement | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const side of [outwardSide, -outwardSide]) {
      for (const distance of [44, 60, 80, 102]) {
        const offsetX = projection.segment.isHorizontal ? options.laneOffset + stableAxisNudge : side * distance;
        const offsetY = projection.segment.isHorizontal ? side * distance : options.laneOffset + stableAxisNudge;
        const candidate = createLabelPlacement(projection.x, projection.y, offsetX, offsetY);
        const score = scoreBaseLabelPlacement(
          candidate,
          labelSize,
          options.obstacleRects,
          projection.segment.length,
          side === outwardSide,
          endClearance,
        );

        if (score > bestScore) {
          bestScore = score;
          bestPlacement = candidate;
        }
      }
    }

    return bestPlacement ?? createLabelPlacement(projection.x, projection.y, options.laneOffset, -34);
  };

  if (typeof options.anchorProgress === "number" && Number.isFinite(options.anchorProgress)) {
    const projection = getPolylinePointAtProgress(points, options.anchorProgress);
    return projection ? chooseForProjection(projection) : createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, options.laneOffset, -34);
  }

  const segments = buildRouteSegments(points).filter((segment) => segment.length > 12);
  if (segments.length === 0) {
    return createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, options.laneOffset, -34);
  }

  const stableRatioNudge = clamp(getStableLabelNudge(options.edgeId) / 180, -0.14, 0.14);
  let bestPlacement: LabelPlacement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const totalLength = segments[segments.length - 1]?.cumulativeEnd ?? 1;

  for (const segment of segments) {
    const baseRatios = segment.length >= 220 ? [0.22, 0.38, 0.62, 0.78] : segment.length >= 120 ? [0.3, 0.5, 0.7] : [0.5];
    const ratios = [...new Set(baseRatios.flatMap((ratio) => [ratio, clamp(ratio + stableRatioNudge, 0.2, 0.8)]))];

    for (const ratio of ratios) {
      const projection = getPolylinePointAtProgress(points, (segment.cumulativeStart + segment.length * ratio) / totalLength);
      if (!projection) {
        continue;
      }

      const candidate = chooseForProjection(projection);
      const endClearance = Math.min(projection.distanceFromSegmentStart, projection.segment.length - projection.distanceFromSegmentStart);
      const score = scoreBaseLabelPlacement(
        candidate,
        labelSize,
        options.obstacleRects,
        projection.segment.length,
        true,
        endClearance,
      );

      if (score > bestScore) {
        bestScore = score;
        bestPlacement = candidate;
      }
    }
  }

  return bestPlacement ?? createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, options.laneOffset, -34);
}

function getIncidentEdgeLane(edges: AppEdge[], edgeId: string, sourceId: string, targetId: string) {
  const incidentIds = edges
    .filter(
      (edge) =>
        edge.source === sourceId ||
        edge.target === sourceId ||
        edge.source === targetId ||
        edge.target === targetId,
    )
    .map((edge) => edge.id)
    .sort((left, right) => left.localeCompare(right));
  const currentIndex = incidentIds.indexOf(edgeId);
  const centeredIndex = currentIndex === -1 ? 0 : currentIndex - (incidentIds.length - 1) / 2;

  return centeredIndex * 26 + getStableLabelNudge(edgeId) * 0.65;
}

function parseShapeHandleSide(handleId: string | null | undefined, fallback: ShapeHandleId): ShapeHandleId {
  const suffix = handleId?.split("-").pop();
  return suffix === "top" || suffix === "right" || suffix === "bottom" || suffix === "left" ? suffix : fallback;
}

function roundPoint(point: Point): Point {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function normalizePreviewPoints(points: Point[]) {
  const normalized: Point[] = [];

  for (const point of points) {
    const roundedPoint = roundPoint(point);
    const previousPoint = normalized[normalized.length - 1];

    if (previousPoint && previousPoint.x === roundedPoint.x && previousPoint.y === roundedPoint.y) {
      continue;
    }

    normalized.push(roundedPoint);
  }

  const collapsed: Point[] = [];

  for (const point of normalized) {
    const previousPoint = collapsed[collapsed.length - 1];
    const beforePreviousPoint = collapsed[collapsed.length - 2];

    if (!previousPoint || !beforePreviousPoint) {
      collapsed.push(point);
      continue;
    }

    const sameVertical = beforePreviousPoint.x === previousPoint.x && previousPoint.x === point.x;
    const sameHorizontal = beforePreviousPoint.y === previousPoint.y && previousPoint.y === point.y;

    if (sameVertical || sameHorizontal) {
      collapsed[collapsed.length - 1] = point;
      continue;
    }

    collapsed.push(point);
  }

  return collapsed;
}

function buildStepPreviewPoints(
  sourceFrame: LayoutNodeFrame,
  targetFrame: LayoutNodeFrame,
  sourceSide: ShapeHandleId,
  targetSide: ShapeHandleId,
  manualRoute?: Array<{ x: number; y: number }>,
  manualRouteMode?: NonNullable<AppEdge["data"]>["manualRouteMode"],
) {
  const sourcePoint = getHandleCenterFromFrame(sourceFrame, sourceSide);
  const targetPoint = getHandleCenterFromFrame(targetFrame, targetSide);
  const edgeDistance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
  const clearance = clamp(edgeDistance * 0.18, 28, 60);
  const sourceVector = HANDLE_VECTORS[sourceSide];
  const targetVector = HANDLE_VECTORS[targetSide];
  const sourceOuter = {
    x: sourcePoint.x + sourceVector.x * clearance,
    y: sourcePoint.y + sourceVector.y * clearance,
  };
  const targetOuter = {
    x: targetPoint.x + targetVector.x * clearance,
    y: targetPoint.y + targetVector.y * clearance,
  };

  if (manualRoute && manualRoute.length > 0) {
    return normalizePreviewPoints(
      manualRouteMode === "full"
        ? [sourcePoint, ...manualRoute, targetPoint]
        : [sourcePoint, sourceOuter, ...manualRoute, targetOuter, targetPoint],
    );
  }

  const sourceAxis = getHandleAxis(sourceSide);
  const targetAxis = getHandleAxis(targetSide);
  const inner: Point[] = [];

  if (sourceAxis === "horizontal" && targetAxis === "horizontal") {
    if (sourceSide === targetSide) {
      const extra = clamp(Math.abs(targetOuter.x - sourceOuter.x) * 0.18, 32, 80);
      const routeX = sourceSide === "right" ? Math.max(sourceOuter.x, targetOuter.x) + extra : Math.min(sourceOuter.x, targetOuter.x) - extra;
      inner.push({ x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y });
    } else {
      const routeX = (sourceOuter.x + targetOuter.x) / 2;
      inner.push({ x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y });
    }
  } else if (sourceAxis === "vertical" && targetAxis === "vertical") {
    if (sourceSide === targetSide) {
      const extra = clamp(Math.abs(targetOuter.y - sourceOuter.y) * 0.18, 32, 80);
      const routeY = sourceSide === "bottom" ? Math.max(sourceOuter.y, targetOuter.y) + extra : Math.min(sourceOuter.y, targetOuter.y) - extra;
      inner.push({ x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY });
    } else {
      const routeY = (sourceOuter.y + targetOuter.y) / 2;
      inner.push({ x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY });
    }
  } else if (sourceAxis === "horizontal") {
    inner.push({ x: targetOuter.x, y: sourceOuter.y });
  } else {
    inner.push({ x: sourceOuter.x, y: targetOuter.y });
  }

  return normalizePreviewPoints([sourcePoint, sourceOuter, ...inner, targetOuter, targetPoint]);
}

function createSegmentCorridorRect(start: Point, end: Point, padding: number): Rect {
  return {
    left: Math.min(start.x, end.x) - padding,
    top: Math.min(start.y, end.y) - padding,
    right: Math.max(start.x, end.x) + padding,
    bottom: Math.max(start.y, end.y) + padding,
  };
}

function getRouteLength(points: Point[]) {
  return points.slice(0, -1).reduce((total, point, index) => total + Math.hypot(points[index + 1].x - point.x, points[index + 1].y - point.y), 0);
}

function buildCandidateAnchorProgresses(points: Point[]) {
  const routeSegments = buildRouteSegments(points);
  const totalLength = routeSegments[routeSegments.length - 1]?.cumulativeEnd ?? 0;
  const progressValues = new Set<number>();

  for (const segment of routeSegments) {
    const baseRatios = segment.length >= 220 ? [0.22, 0.38, 0.62, 0.78] : segment.length >= 120 ? [0.3, 0.5, 0.7] : [0.5];

    for (const ratio of baseRatios) {
      if (totalLength <= 0) {
        continue;
      }

      const progress = clamp((segment.cumulativeStart + segment.length * ratio) / totalLength, 0.12, 0.88);
      progressValues.add(Number(progress.toFixed(4)));
    }
  }

  if (progressValues.size === 0) {
    progressValues.add(0.5);
  }

  return [...progressValues].sort((left, right) => left - right);
}

function buildEdgePreviewFrame(edge: AppEdge, nodeMap: Map<string, LayoutNodeFrame>, edges: AppEdge[]): EdgePreviewFrame | null {
  const sourceFrame = nodeMap.get(edge.source);
  const targetFrame = nodeMap.get(edge.target);

  if (!sourceFrame || !targetFrame || edge.source === edge.target) {
    return null;
  }

  const preferredHandlePair = getPreferredHandlePairFromFrame(sourceFrame, targetFrame);
  const sourceSide = parseShapeHandleSide(edge.sourceHandle, preferredHandlePair.sourceSide);
  const targetSide = parseShapeHandleSide(edge.targetHandle, preferredHandlePair.targetSide);
  const pathStyle = edge.data?.pathStyle ?? "smoothstep";
  const points =
    pathStyle === "straight"
      ? [getHandleCenterFromFrame(sourceFrame, sourceSide), getHandleCenterFromFrame(targetFrame, targetSide)]
      : buildStepPreviewPoints(
          sourceFrame,
          targetFrame,
          sourceSide,
          targetSide,
          edge.data?.manualRoute,
          edge.data?.manualRouteMode,
        );
  const labelText = typeof edge.label === "string" ? edge.label : "";
  const labelSize = estimateEdgeLabelSize(labelText);
  const nodeObstacleRects = [...nodeMap.values()].map((frame) => expandRect(createRectFromFrame(frame), 16));
  const routeCorridors = buildRouteSegments(points).map((segment) => createSegmentCorridorRect(segment.start, segment.end, 10));

  return {
    edge,
    labelText,
    labelSize,
    points,
    routeLength: getRouteLength(points),
    nodeObstacleRects,
    routeCorridors,
    laneOffset: getIncidentEdgeLane(edges, edge.id, edge.source, edge.target),
    isManualLabel: isManualLabelPlacement(edge),
  };
}

function scoreOptimizedLabelPlacement(
  placement: LabelPlacement,
  basePlacement: LabelPlacement,
  size: LabelSize,
  nodeObstacleRects: Rect[],
  labelObstacleRects: Rect[],
  selfRouteCorridors: Rect[],
  otherRouteCorridors: Rect[],
) {
  const labelRect = createLabelRect(placement.bubbleX, placement.bubbleY, size);
  const expandedLabelObstacleRects = labelObstacleRects.map((rect) => expandRect(rect, 10));
  const minNodeClearance = getMinimumRectClearance(labelRect, [...nodeObstacleRects, ...expandedLabelObstacleRects]);
  const minSelfRouteClearance = getMinimumRectClearance(labelRect, selfRouteCorridors);
  const minOtherRouteClearance = getMinimumRectClearance(labelRect, otherRouteCorridors);
  const safeNodeClearance = Number.isFinite(minNodeClearance) ? minNodeClearance : 80;
  const safeSelfRouteClearance = Number.isFinite(minSelfRouteClearance) ? minSelfRouteClearance : 64;
  const safeOtherRouteClearance = Number.isFinite(minOtherRouteClearance) ? minOtherRouteClearance : 64;
  const connectorPenalty = [...nodeObstacleRects, ...expandedLabelObstacleRects].reduce(
    (total, rect) =>
      total +
      (segmentIntersectsRect(
        { x: placement.anchorX, y: placement.anchorY },
        { x: placement.bubbleX, y: placement.bubbleY },
        rect,
      )
        ? 260
        : 0),
    0,
  );
  const driftPenalty = Math.hypot(placement.bubbleX - basePlacement.bubbleX, placement.bubbleY - basePlacement.bubbleY) * 0.3;
  const overlapPenalty = safeNodeClearance < 0 ? Math.abs(safeNodeClearance) * 132 : 0;
  const nearPenalty = safeNodeClearance >= 0 && safeNodeClearance < 22 ? (22 - safeNodeClearance) * 18 : 0;
  const selfRoutePenalty =
    safeSelfRouteClearance < 0
      ? Math.abs(safeSelfRouteClearance) * 64
      : safeSelfRouteClearance < 10
        ? (10 - safeSelfRouteClearance) * 14
        : 0;
  const otherRoutePenalty =
    safeOtherRouteClearance < 0
      ? Math.abs(safeOtherRouteClearance) * 108
      : safeOtherRouteClearance < 16
        ? (16 - safeOtherRouteClearance) * 20
        : 0;

  return (
    safeNodeClearance * 18 +
    safeSelfRouteClearance * 4 +
    safeOtherRouteClearance * 8 +
    Math.min(Math.hypot(placement.bubbleX - placement.anchorX, placement.bubbleY - placement.anchorY), 120) * 0.25 -
    connectorPenalty -
    driftPenalty -
    overlapPenalty -
    nearPenalty -
    selfRoutePenalty -
    otherRoutePenalty
  );
}


function optimizeEdgeLabelPlacements(edges: AppEdge[], nodeMap: Map<string, LayoutNodeFrame>) {
  const previewFrames = edges
    .map((edge) => buildEdgePreviewFrame(edge, nodeMap, edges))
    .filter((frame): frame is EdgePreviewFrame => Boolean(frame));
  const previewFrameMap = new Map(previewFrames.map((frame) => [frame.edge.id, frame] as const));
  const fixedLabelRects: Array<{ edgeId: string; rect: Rect }> = [];
  const placedLabelRects: Array<{ edgeId: string; rect: Rect }> = [];
  const placements = new Map<string, OptimizedEdgeLabelPlacement>();

  for (const previewFrame of previewFrames) {
    if (!previewFrame.isManualLabel) {
      continue;
    }

    const basePlacement = chooseBestLabelPlacement(previewFrame.points, {
      edgeId: previewFrame.edge.id,
      labelText: previewFrame.labelText,
      obstacleRects: previewFrame.nodeObstacleRects,
      laneOffset: previewFrame.laneOffset,
      anchorProgress: previewFrame.edge.data?.labelAnchorPosition,
    });
    const actualPlacement = applyLabelOffset(
      basePlacement,
      previewFrame.edge.data?.labelOffset?.x ?? 0,
      previewFrame.edge.data?.labelOffset?.y ?? 0,
    );

    fixedLabelRects.push({
      edgeId: previewFrame.edge.id,
      rect: createLabelRect(actualPlacement.bubbleX, actualPlacement.bubbleY, previewFrame.labelSize),
    });
  }

  const autoPreviewFrames = previewFrames
    .filter((previewFrame) => !previewFrame.isManualLabel)
    .sort((left, right) => {
      if (left.routeLength !== right.routeLength) {
        return left.routeLength - right.routeLength;
      }

      if (left.labelSize.area !== right.labelSize.area) {
        return right.labelSize.area - left.labelSize.area;
      }

      return left.edge.id.localeCompare(right.edge.id);
    });

  for (const previewFrame of autoPreviewFrames) {
    const otherRouteCorridors = previewFrames
      .filter((candidate) => candidate.edge.id !== previewFrame.edge.id)
      .flatMap((candidate) => candidate.routeCorridors);
    const labelObstacleRects = [...fixedLabelRects, ...placedLabelRects]
      .filter((candidate) => candidate.edgeId !== previewFrame.edge.id)
      .map((candidate) => candidate.rect);
    let bestCandidate:
      | {
          labelOffset: { x: number; y: number };
          labelAnchorPosition: number;
          placement: LabelPlacement;
          rect: Rect;
          score: number;
        }
      | null = null;

    for (const anchorProgress of buildCandidateAnchorProgresses(previewFrame.points)) {
      const basePlacement = chooseBestLabelPlacement(previewFrame.points, {
        edgeId: previewFrame.edge.id,
        labelText: previewFrame.labelText,
        obstacleRects: previewFrame.nodeObstacleRects,
        laneOffset: previewFrame.laneOffset,
        anchorProgress,
      });
      const normalVector = {
        x: basePlacement.bubbleX - basePlacement.anchorX,
        y: basePlacement.bubbleY - basePlacement.anchorY,
      };
      const normalLength = Math.hypot(normalVector.x, normalVector.y) || 1;
      const normal = {
        x: normalVector.x / normalLength,
        y: normalVector.y / normalLength,
      };
      const tangent = {
        x: -normal.y,
        y: normal.x,
      };

      for (const normalOffset of [0, 14, 28, 42, 58]) {
        for (const tangentOffset of [0, -18, 18, -34, 34]) {
          const offsetX = normal.x * normalOffset + tangent.x * tangentOffset;
          const offsetY = normal.y * normalOffset + tangent.y * tangentOffset;
          const placement = applyLabelOffset(basePlacement, offsetX, offsetY);
          const rect = createLabelRect(placement.bubbleX, placement.bubbleY, previewFrame.labelSize);
          const score = scoreOptimizedLabelPlacement(
            placement,
            basePlacement,
            previewFrame.labelSize,
            previewFrame.nodeObstacleRects,
            labelObstacleRects,
            previewFrame.routeCorridors,
            otherRouteCorridors,
          );

          if (!bestCandidate || score > bestCandidate.score) {
            bestCandidate = {
              labelOffset: {
                x: Math.round(offsetX),
                y: Math.round(offsetY),
              },
              labelAnchorPosition: anchorProgress,
              placement,
              rect,
              score,
            };
          }
        }
      }
    }

    if (!bestCandidate) {
      continue;
    }

    placements.set(previewFrame.edge.id, {
      labelOffset: bestCandidate.labelOffset,
      labelAnchorPosition: bestCandidate.labelAnchorPosition,
      labelPlacementMode: "auto",
    });
    placedLabelRects.push({
      edgeId: previewFrame.edge.id,
      rect: bestCandidate.rect,
    });
  }

  return {
    previewFrameMap,
    placements,
  };
}

function inferHandleSideFromPoint(
  point: ElkPoint | undefined,
  frame: LayoutNodeFrame,
  fallbackSide: ShapeHandleId,
): ShapeHandleId {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return fallbackSide;
  }

  const distances: Array<[ShapeHandleId, number]> = [
    ["top", Math.abs(point.y - frame.y)],
    ["right", Math.abs(point.x - (frame.x + frame.width))],
    ["bottom", Math.abs(point.y - (frame.y + frame.height))],
    ["left", Math.abs(point.x - frame.x)],
  ];

  distances.sort((left, right) => left[1] - right[1]);
  return distances[0]?.[0] ?? fallbackSide;
}

function normalizeManualRoute(points: ElkPoint[]) {
  const normalized: Array<{ x: number; y: number }> = [];

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    const nextPoint = {
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
    const previous = normalized[normalized.length - 1];

    if (previous && previous.x === nextPoint.x && previous.y === nextPoint.y) {
      continue;
    }

    normalized.push(nextPoint);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function getHandleAxis(side: ShapeHandleId) {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

function buildFallbackManualRoute(
  section: ElkEdgeSection,
  sourceFrame: LayoutNodeFrame,
  targetFrame: LayoutNodeFrame,
  sourceSide: ShapeHandleId,
  targetSide: ShapeHandleId,
) {
  const sourceHandleCenter = getHandleCenterFromFrame(sourceFrame, sourceSide);
  const targetHandleCenter = getHandleCenterFromFrame(targetFrame, targetSide);
  const sourceAxis = getHandleAxis(sourceSide);
  const targetAxis = getHandleAxis(targetSide);
  const edgeDistance = Math.hypot(targetHandleCenter.x - sourceHandleCenter.x, targetHandleCenter.y - sourceHandleCenter.y);
  const clearance = clamp(edgeDistance * 0.16, 24, 46);
  const sourceVector = HANDLE_VECTORS[sourceSide];
  const targetVector = HANDLE_VECTORS[targetSide];
  const sourceOuter = {
    x: Math.round(sourceHandleCenter.x + sourceVector.x * clearance),
    y: Math.round(sourceHandleCenter.y + sourceVector.y * clearance),
  };
  const targetOuter = {
    x: Math.round(targetHandleCenter.x + targetVector.x * clearance),
    y: Math.round(targetHandleCenter.y + targetVector.y * clearance),
  };

  if (sourceAxis === "horizontal" && targetAxis === "horizontal") {
    const routeY = Math.round((section.startPoint.y + section.endPoint.y) / 2);
    return normalizeManualRoute([
      { x: sourceOuter.x, y: routeY },
      { x: targetOuter.x, y: routeY },
    ]);
  }

  if (sourceAxis === "vertical" && targetAxis === "vertical") {
    const routeX = Math.round((section.startPoint.x + section.endPoint.x) / 2);
    return normalizeManualRoute([
      { x: routeX, y: sourceOuter.y },
      { x: routeX, y: targetOuter.y },
    ]);
  }

  return undefined;
}

function buildDisconnectedLayoutMap(nodes: ShapeGraphNode[]) {
  const sortedNodes = getSortedShapeNodes(nodes);
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(sortedNodes.length)));
  const sizeMap = new Map(sortedNodes.map((node) => [node.id, getLayoutNodeMinimumSize(node)] as const));
  const maxWidth = Math.max(...sortedNodes.map((node) => sizeMap.get(node.id)?.width ?? getNodeWidth(node)), 0);
  const maxHeight = Math.max(...sortedNodes.map((node) => sizeMap.get(node.id)?.height ?? getNodeHeight(node)), 0);
  const horizontalGap = 96;
  const verticalGap = 84;
  const padding = 56;

  return new Map<string, LayoutNodeFrame>(
    sortedNodes.map((node, index) => {
      const columnIndex = index % columnCount;
      const rowIndex = Math.floor(index / columnCount);
      const minimumSize = sizeMap.get(node.id) ?? getLayoutNodeMinimumSize(node);
      const width = minimumSize.width;
      const height = minimumSize.height;

      return [
        node.id,
        {
          kind: node.data.kind,
          x: padding + columnIndex * (maxWidth + horizontalGap),
          y: padding + rowIndex * (maxHeight + verticalGap),
          width,
          height,
        },
      ];
    }),
  );
}

function toLayoutGraph(nodes: ShapeGraphNode[], edges: AppEdge[]): ElkNode {
  return {
    id: "root",
    layoutOptions: GRAPH_LAYOUT_OPTIONS,
    children: getSortedShapeNodes(nodes).map((node) => {
      const minimumSize = getLayoutNodeMinimumSize(node);

      return {
        id: node.id,
        width: minimumSize.width,
        height: minimumSize.height,
        labels: node.data.text.trim().length
          ? [
              {
                id: `${node.id}-label`,
                text: node.data.text,
                width: minimumSize.label.width,
                height: minimumSize.label.height,
              },
            ]
          : undefined,
        layoutOptions: {
          "elk.nodeLabels.placement": "[H_CENTER, V_CENTER, INSIDE]",
          "elk.nodeSize.constraints": "NODE_LABELS MINIMUM_SIZE",
          "elk.nodeSize.options": "MINIMUM_SIZE_ACCOUNTS_FOR_PADDING",
          "elk.nodeSize.minimum": `(${minimumSize.width}, ${minimumSize.height})`,
        },
      } satisfies ElkNode;
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

async function createElkInstance() {
  const elkModule = await import("elkjs/lib/elk.bundled.js");
  return new elkModule.default();
}

function buildEdgeRouteFrame(layoutEdge: ElkExtendedEdge, nodeMap: Map<string, LayoutNodeFrame>) {
  const sourceId = layoutEdge.sources?.[0];
  const targetId = layoutEdge.targets?.[0];

  if (!sourceId || !targetId) {
    return null;
  }

  const sourceFrame = nodeMap.get(sourceId);
  const targetFrame = nodeMap.get(targetId);

  if (!sourceFrame || !targetFrame) {
    return null;
  }

  const section = layoutEdge.sections?.[0];
  const preferredHandlePair = getPreferredHandlePairFromFrame(sourceFrame, targetFrame);
  const sourceSide = inferHandleSideFromPoint(section?.startPoint, sourceFrame, preferredHandlePair.sourceSide);
  const targetSide = inferHandleSideFromPoint(section?.endPoint, targetFrame, preferredHandlePair.targetSide);

  return {
    sourceHandle: buildHandleId("source", sourceSide),
    targetHandle: buildHandleId("target", targetSide),
    manualRoute:
      section && section.bendPoints && section.bendPoints.length > 0
        ? normalizeManualRoute(section.bendPoints)
        : section
          ? buildFallbackManualRoute(section, sourceFrame, targetFrame, sourceSide, targetSide)
          : undefined,
  } satisfies LayoutEdgeRouteFrame;
}

async function buildLayoutGraphFrame(nodes: ShapeGraphNode[], edges: AppEdge[]): Promise<LayoutGraphFrame> {
  if (nodes.length === 0) {
    return {
      nodeMap: new Map<string, LayoutNodeFrame>(),
      edgeRouteMap: new Map<string, LayoutEdgeRouteFrame>(),
    };
  }

  if (edges.length === 0) {
    return {
      nodeMap: buildDisconnectedLayoutMap(nodes),
      edgeRouteMap: new Map<string, LayoutEdgeRouteFrame>(),
    };
  }

  const elk = await createElkInstance();
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const componentFrames: LayoutGraphFrame[] = [];

  for (const componentIds of getConnectedShapeComponents(nodes, edges)) {
    const componentIdSet = new Set(componentIds);
    const componentNodes = componentIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is ShapeGraphNode => Boolean(node));
    const componentEdges = edges.filter(
      (edge) => componentIdSet.has(edge.source) && componentIdSet.has(edge.target) && edge.source !== edge.target,
    );

    if (componentEdges.length === 0) {
      const componentNodeMap = buildDisconnectedLayoutMap(componentNodes);
      const bounds = getNodeMapBounds(componentNodeMap);
      componentFrames.push({
        nodeMap: translateLayoutNodeMap(componentNodeMap, -bounds.minX, -bounds.minY),
        edgeRouteMap: new Map<string, LayoutEdgeRouteFrame>(),
      });
      continue;
    }

    const layoutResult = await elk.layout(toLayoutGraph(componentNodes, componentEdges));
    const nodeKindMap = new Map(componentNodes.map((node) => [node.id, node.data.kind] as const));
    const componentNodeMap = new Map<string, LayoutNodeFrame>(
      (layoutResult.children ?? []).map((node) => [
        node.id,
        {
          kind: nodeKindMap.get(node.id) ?? "rectangle",
          x: typeof node.x === "number" ? node.x : 0,
          y: typeof node.y === "number" ? node.y : 0,
          width: typeof node.width === "number" ? node.width : 0,
          height: typeof node.height === "number" ? node.height : 0,
        },
      ]),
    );
    const componentEdgeRouteMap = new Map<string, LayoutEdgeRouteFrame>();

    for (const layoutEdge of layoutResult.edges ?? []) {
      const routeFrame = buildEdgeRouteFrame(layoutEdge, componentNodeMap);

      if (routeFrame) {
        componentEdgeRouteMap.set(layoutEdge.id, routeFrame);
      }
    }

    const bounds = getNodeMapBounds(componentNodeMap);
    componentFrames.push({
      nodeMap: translateLayoutNodeMap(componentNodeMap, -bounds.minX, -bounds.minY),
      edgeRouteMap: translateEdgeRouteMap(componentEdgeRouteMap, -bounds.minX, -bounds.minY),
    });
  }

  const mergedNodeMap = new Map<string, LayoutNodeFrame>();
  const mergedEdgeRouteMap = new Map<string, LayoutEdgeRouteFrame>();

  for (const componentFrame of componentFrames) {
    for (const [nodeId, frame] of componentFrame.nodeMap.entries()) {
      mergedNodeMap.set(nodeId, frame);
    }

    for (const [edgeId, frame] of componentFrame.edgeRouteMap.entries()) {
      mergedEdgeRouteMap.set(edgeId, frame);
    }
  }

  return {
    nodeMap: mergedNodeMap,
    edgeRouteMap: mergedEdgeRouteMap,
  };
}

export async function layoutGraphDocument(document: GraphDocument): Promise<GraphDocument> {
  const clonedDocument = structuredClone(document);
  const shapeNodes = clonedDocument.nodes.filter(isShapeGraphNode);

  if (shapeNodes.length <= 1) {
    return clonedDocument;
  }

  const shapeNodeIds = new Set(shapeNodes.map((node) => node.id));
  const layoutEdges = clonedDocument.edges.filter(
    (edge) => shapeNodeIds.has(edge.source) && shapeNodeIds.has(edge.target) && edge.source !== edge.target,
  );

  const { nodeMap: rawLayoutNodeMap } = await buildLayoutGraphFrame(shapeNodes, layoutEdges);
  const layoutNodeMap = normalizeLayoutNodeMap(rawLayoutNodeMap, shapeNodes, layoutEdges);

  const nextNodes = clonedDocument.nodes.map((node) => {
    if (!isShapeGraphNode(node)) {
      return node;
    }

    const layoutNode = layoutNodeMap.get(node.id);
    if (!layoutNode) {
      return node;
    }

    const width = Number.isFinite(layoutNode.width) && layoutNode.width > 0 ? Math.round(layoutNode.width) : getNodeWidth(node);
    const height = Number.isFinite(layoutNode.height) && layoutNode.height > 0 ? Math.round(layoutNode.height) : getNodeHeight(node);

    return {
      ...node,
      position: {
        x: Number.isFinite(layoutNode.x) ? Math.round(layoutNode.x) : node.position.x,
        y: Number.isFinite(layoutNode.y) ? Math.round(layoutNode.y) : node.position.y,
      },
      width,
      height,
      initialWidth: width,
      initialHeight: height,
    };
  });

  const nextEdges = clonedDocument.edges.map((edge) => {
    const sourceFrame = layoutNodeMap.get(edge.source);
    const targetFrame = layoutNodeMap.get(edge.target);

    if (!sourceFrame || !targetFrame || edge.source === edge.target) {
      return edge;
    }

    const preferredHandlePair = getPreferredHandlePairFromFrame(sourceFrame, targetFrame);
    const sourceSide = preferredHandlePair.sourceSide;
    const targetSide = preferredHandlePair.targetSide;
    const canUseStraight = shouldUseStraightLayoutEdge(
      edge,
      sourceFrame,
      targetFrame,
      sourceSide,
      targetSide,
      layoutNodeMap,
      layoutEdges,
    );
    const nextPathStyle = edge.data?.pathStyle === "straight" || canUseStraight ? "straight" : "step";
    const shouldPreserveManualLabel = isManualLabelPlacement(edge);
    const nextManualRoute = undefined;

    return createRelationEdge({
      ...edge,
      id: edge.id,
      label: typeof edge.label === "string" ? edge.label : "",
      sourceHandle: buildHandleId("source", sourceSide),
      targetHandle: buildHandleId("target", targetSide),
      data: {
        pathStyle: nextPathStyle,
        dashed: edge.data?.dashed ?? false,
        marker: edge.data?.marker ?? "arrow",
        color: edge.data?.color ?? "#64748b",
        labelOffset: shouldPreserveManualLabel ? edge.data?.labelOffset : undefined,
        labelAnchorPosition: shouldPreserveManualLabel ? edge.data?.labelAnchorPosition : undefined,
        labelPlacementMode: shouldPreserveManualLabel ? "manual" : undefined,
        manualRoute: nextManualRoute,
        manualRouteMode: nextManualRoute ? "inner" : undefined,
      },
    });
  });

  const { placements: optimizedLabelPlacements } = optimizeEdgeLabelPlacements(nextEdges, layoutNodeMap);
  const finalEdges = nextEdges.map((edge) => {
    const optimizedPlacement = optimizedLabelPlacements.get(edge.id);

    if (!optimizedPlacement) {
      return edge;
    }

    return createRelationEdge({
      ...edge,
      id: edge.id,
      label: typeof edge.label === "string" ? edge.label : "",
      data: {
        pathStyle: edge.data?.pathStyle ?? "smoothstep",
        dashed: edge.data?.dashed ?? false,
        marker: edge.data?.marker ?? "arrow",
        color: edge.data?.color ?? "#64748b",
        labelOffset: optimizedPlacement.labelOffset,
        labelAnchorPosition: optimizedPlacement.labelAnchorPosition,
        labelPlacementMode: optimizedPlacement.labelPlacementMode,
        manualRoute: edge.data?.manualRoute,
        manualRouteMode: edge.data?.manualRouteMode,
      },
    });
  });

  return {
    nodes: nextNodes,
    edges: finalEdges,
    viewport: clonedDocument.viewport ?? defaultViewport,
  };
}
