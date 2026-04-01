import type { XYPosition } from "@xyflow/react";

import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LINE_WIDTH,
  SHAPE_NODE_DIMENSIONS,
  getShapeHandlePoint,
  type AppNode,
  type LineAnchor,
  type LineNode,
  type ShapeHandleId,
  type ShapeNode,
} from "./sample-graph";

const SHAPE_HANDLES: ShapeHandleId[] = ["top", "right", "bottom", "left"];

export const LINE_MIN_WIDTH = 96;
export const LINE_SNAP_DISTANCE = 96;
const DOUBLE_ANCHOR_VERTICAL_TOLERANCE = 28;

type EndpointMatch = {
  anchor: LineAnchor;
  point: XYPosition;
  distance: number;
};

function round(value: number) {
  return Math.round(value);
}

function getShapeNodeSize(node: ShapeNode) {
  const fallback = SHAPE_NODE_DIMENSIONS[node.data.kind];

  return {
    width: node.measured?.width ?? node.width ?? node.initialWidth ?? fallback.width,
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? fallback.height,
  };
}

export function getLineNodeSize(node: Pick<LineNode, "width" | "height" | "initialWidth" | "initialHeight" | "measured">) {
  return {
    width: Math.max(node.measured?.width ?? node.width ?? node.initialWidth ?? DEFAULT_LINE_WIDTH, LINE_MIN_WIDTH),
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? DEFAULT_LINE_HEIGHT,
  };
}

function getHandlePoint(node: ShapeNode, handle: ShapeHandleId): XYPosition {
  const { width, height } = getShapeNodeSize(node);

  return getShapeHandlePoint(
    {
      kind: node.data.kind,
      x: node.position.x,
      y: node.position.y,
      width,
      height,
    },
    handle,
  );
}

function getLineEndpoints(node: LineNode) {
  const { width, height } = getLineNodeSize(node);
  const centerY = node.position.y + height / 2;

  return {
    width,
    height,
    start: { x: node.position.x, y: centerY },
    end: { x: node.position.x + width, y: centerY },
  };
}

function findNearestShapeHandle(point: XYPosition, nodes: AppNode[]): EndpointMatch | null {
  let bestMatch: EndpointMatch | null = null;

  for (const node of nodes) {
    if (node.type !== "shapeNode") {
      continue;
    }

    for (const handle of SHAPE_HANDLES) {
      const handlePoint = getHandlePoint(node, handle);
      const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y);

      if (distance > LINE_SNAP_DISTANCE) {
        continue;
      }

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = {
          anchor: {
            nodeId: node.id,
            handle,
          },
          point: handlePoint,
          distance,
        };
      }
    }
  }

  return bestMatch;
}

function resolveAnchorPoint(anchor: LineAnchor | undefined, nodes: AppNode[]) {
  if (!anchor) {
    return null;
  }

  const targetNode = nodes.find((node) => node.id === anchor.nodeId && node.type === "shapeNode");
  if (!targetNode || targetNode.type !== "shapeNode") {
    return null;
  }

  return {
    anchor,
    point: getHandlePoint(targetNode, anchor.handle),
  };
}

function anchorsEqual(left?: LineAnchor, right?: LineAnchor) {
  return left?.nodeId === right?.nodeId && left?.handle === right?.handle;
}

function applyLineGeometry(
  node: LineNode,
  geometry: { x: number; y: number; width: number; height?: number },
  anchors?: { anchorStart?: LineAnchor; anchorEnd?: LineAnchor },
) {
  const nextWidth = Math.max(round(geometry.width), LINE_MIN_WIDTH);
  const nextHeight = round(geometry.height ?? getLineNodeSize(node).height);
  const nextX = round(geometry.x);
  const nextY = round(geometry.y);
  const nextAnchorStart = anchors?.anchorStart;
  const nextAnchorEnd = anchors?.anchorEnd;

  const unchanged =
    round(node.position.x) === nextX &&
    round(node.position.y) === nextY &&
    round(getLineNodeSize(node).width) === nextWidth &&
    round(getLineNodeSize(node).height) === nextHeight &&
    anchorsEqual(node.data.anchorStart, nextAnchorStart) &&
    anchorsEqual(node.data.anchorEnd, nextAnchorEnd);

  if (unchanged) {
    return node;
  }

  return {
    ...node,
    position: { x: nextX, y: nextY },
    width: nextWidth,
    height: nextHeight,
    initialWidth: nextWidth,
    initialHeight: nextHeight,
    data: {
      ...node.data,
      anchorStart: nextAnchorStart,
      anchorEnd: nextAnchorEnd,
    },
  };
}

export function clearLineNodeAnchors(node: LineNode) {
  if (!node.data.anchorStart && !node.data.anchorEnd) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      anchorStart: undefined,
      anchorEnd: undefined,
    },
  };
}

export function snapLineNodeAuto(node: LineNode, nodes: AppNode[]) {
  const { start, end, height } = getLineEndpoints(node);
  const startMatch = findNearestShapeHandle(start, nodes);
  const endMatch = findNearestShapeHandle(end, nodes);

  if (startMatch && endMatch) {
    const [leftMatch, rightMatch] = startMatch.point.x <= endMatch.point.x ? [startMatch, endMatch] : [endMatch, startMatch];

    if (
      (leftMatch.anchor.nodeId !== rightMatch.anchor.nodeId || leftMatch.anchor.handle !== rightMatch.anchor.handle) &&
      Math.abs(leftMatch.point.y - rightMatch.point.y) <= DOUBLE_ANCHOR_VERTICAL_TOLERANCE &&
      rightMatch.point.x - leftMatch.point.x >= LINE_MIN_WIDTH
    ) {
      return applyLineGeometry(
        node,
        {
          x: leftMatch.point.x,
          y: (leftMatch.point.y + rightMatch.point.y) / 2 - height / 2,
          width: rightMatch.point.x - leftMatch.point.x,
          height,
        },
        {
          anchorStart: leftMatch.anchor,
          anchorEnd: rightMatch.anchor,
        },
      );
    }
  }

  const bestSingleMatch = [
    startMatch ? { endpoint: "start" as const, match: startMatch } : null,
    endMatch ? { endpoint: "end" as const, match: endMatch } : null,
  ]
    .filter((item): item is { endpoint: "start" | "end"; match: EndpointMatch } => item !== null)
    .sort((left, right) => left.match.distance - right.match.distance)[0];

  if (!bestSingleMatch) {
    return clearLineNodeAnchors(node);
  }

  if (bestSingleMatch.endpoint === "start") {
    const nextWidth = Math.max(end.x - bestSingleMatch.match.point.x, LINE_MIN_WIDTH);

    return applyLineGeometry(
      node,
      {
        x: end.x - nextWidth,
        y: bestSingleMatch.match.point.y - height / 2,
        width: nextWidth,
        height,
      },
      {
        anchorStart: bestSingleMatch.match.anchor,
        anchorEnd: undefined,
      },
    );
  }

  const nextWidth = Math.max(bestSingleMatch.match.point.x - start.x, LINE_MIN_WIDTH);

  return applyLineGeometry(
    node,
    {
      x: start.x,
      y: bestSingleMatch.match.point.y - height / 2,
      width: nextWidth,
      height,
    },
    {
      anchorStart: undefined,
      anchorEnd: bestSingleMatch.match.anchor,
    },
  );
}

export function reconcileAnchoredLineNode(node: LineNode, nodes: AppNode[]) {
  if (node.dragging) {
    return node;
  }

  const { width, height } = getLineNodeSize(node);
  const startResolved = resolveAnchorPoint(node.data.anchorStart, nodes);
  const endResolved = resolveAnchorPoint(node.data.anchorEnd, nodes);

  if (!startResolved && !endResolved) {
    return clearLineNodeAnchors(node);
  }

  if (startResolved && endResolved) {
    const [leftResolved, rightResolved] =
      startResolved.point.x <= endResolved.point.x ? [startResolved, endResolved] : [endResolved, startResolved];

    if (
      Math.abs(leftResolved.point.y - rightResolved.point.y) <= DOUBLE_ANCHOR_VERTICAL_TOLERANCE &&
      rightResolved.point.x - leftResolved.point.x >= LINE_MIN_WIDTH
    ) {
      return applyLineGeometry(
        node,
        {
          x: leftResolved.point.x,
          y: (leftResolved.point.y + rightResolved.point.y) / 2 - height / 2,
          width: rightResolved.point.x - leftResolved.point.x,
          height,
        },
        {
          anchorStart: leftResolved.anchor,
          anchorEnd: rightResolved.anchor,
        },
      );
    }
  }

  if (startResolved) {
    return applyLineGeometry(
      node,
      {
        x: startResolved.point.x,
        y: startResolved.point.y - height / 2,
        width,
        height,
      },
      {
        anchorStart: startResolved.anchor,
        anchorEnd: undefined,
      },
    );
  }

  if (endResolved) {
    return applyLineGeometry(
      node,
      {
        x: endResolved.point.x - width,
        y: endResolved.point.y - height / 2,
        width,
        height,
      },
      {
        anchorStart: undefined,
        anchorEnd: endResolved.anchor,
      },
    );
  }

  return clearLineNodeAnchors(node);
}
