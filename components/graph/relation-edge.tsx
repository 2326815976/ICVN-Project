"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  Position,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

import { cn } from "@/lib/utils";

import { createRelationEdge, type AppEdge, type AppNode, type RelationEdgeData } from "./sample-graph";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type EdgeSide = "top" | "right" | "bottom" | "left";
type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };

function parseHandleSide(handleId: string | null | undefined, fallback: Position): EdgeSide {
  const suffix = handleId?.split("-").pop();

  if (suffix === "top" || suffix === "right" || suffix === "bottom" || suffix === "left") {
    return suffix;
  }

  if (fallback === Position.Top) {
    return "top";
  }

  if (fallback === Position.Right) {
    return "right";
  }

  if (fallback === Position.Bottom) {
    return "bottom";
  }

  return "left";
}

function getSideVector(side: EdgeSide) {
  if (side === "top") {
    return { x: 0, y: -1 };
  }

  if (side === "right") {
    return { x: 1, y: 0 };
  }

  if (side === "bottom") {
    return { x: 0, y: 1 };
  }

  return { x: -1, y: 0 };
}

function getAxis(side: EdgeSide) {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

function dedupePoints(points: Point[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];

    if (!previous) {
      return true;
    }

    return Math.abs(previous.x - point.x) > 0.5 || Math.abs(previous.y - point.y) > 0.5;
  });
}

type LabelPlacement = {
  anchorX: number;
  anchorY: number;
  bubbleX: number;
  bubbleY: number;
  connectorLength: number;
  connectorAngle: number;
};

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


function getStableLabelNudge(value: string) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }

  return ((hash % 5) - 2) * 12;
}

type LabelPlacementOptions = {
  edgeId: string;
  labelText: string;
  obstacleRects: Rect[];
  laneOffset: number;
  anchorProgress?: number;
};

type LabelSize = {
  width: number;
  height: number;
};

type Segment = {
  start: Point;
  end: Point;
  length: number;
  isHorizontal: boolean;
};

function estimateLabelSize(labelText: string): LabelSize {
  const lines = labelText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const longestLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const lineCount = Math.max(lines.length, 1);

  return {
    width: clamp(longestLineLength * 13 + 56, 132, 240),
    height: clamp(lineCount * 24 + 18, 44, 112),
  };
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

function buildSegments(points: Point[]): Segment[] {
  return points
    .slice(0, -1)
    .map((point, index) => {
      const next = points[index + 1];
      const deltaX = next.x - point.x;
      const deltaY = next.y - point.y;

      return {
        start: point,
        end: next,
        length: Math.hypot(deltaX, deltaY),
        isHorizontal: Math.abs(deltaX) >= Math.abs(deltaY),
      };
    })
    .filter((segment) => segment.length > 12);
}

function getSegmentAnchor(segment: Segment, ratio: number): Point {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  };
}

type RouteSegment = Segment & {
  index: number;
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
      index,
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

function projectPointOntoPolyline(points: Point[], point: Point): PolylineProjection | null {
  const routeSegments = buildRouteSegments(points);
  const totalLength = routeSegments[routeSegments.length - 1]?.cumulativeEnd ?? 0;

  if (routeSegments.length === 0 || totalLength <= 0) {
    return null;
  }

  let bestProjection: PolylineProjection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const segment of routeSegments) {
    const deltaX = segment.end.x - segment.start.x;
    const deltaY = segment.end.y - segment.start.y;
    const ratio = clamp(
      ((point.x - segment.start.x) * deltaX + (point.y - segment.start.y) * deltaY) / (segment.length * segment.length),
      0,
      1,
    );
    const projectedPoint = getSegmentAnchor(segment, ratio);
    const distance = Math.hypot(point.x - projectedPoint.x, point.y - projectedPoint.y);

    if (distance < bestDistance) {
      const distanceFromSegmentStart = segment.length * ratio;
      const distanceFromRouteStart = segment.cumulativeStart + distanceFromSegmentStart;
      bestDistance = distance;
      bestProjection = {
        x: projectedPoint.x,
        y: projectedPoint.y,
        progress: totalLength <= 0 ? 0 : distanceFromRouteStart / totalLength,
        segment,
        segmentRatio: ratio,
        distanceFromSegmentStart,
      };
    }
  }

  return bestProjection;
}

function chooseLabelPlacementForFixedAnchor(
  points: Point[],
  options: LabelPlacementOptions,
  anchorProgress: number,
): LabelPlacement {
  const anchorProjection = getPolylinePointAtProgress(points, anchorProgress);

  if (!anchorProjection) {
    return createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, options.laneOffset, -34);
  }

  const labelSize = estimateLabelSize(options.labelText);
  const centerPoint = points.reduce(
    (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
    { x: 0, y: 0 },
  );
  const graphCenter = {
    x: centerPoint.x / Math.max(points.length, 1),
    y: centerPoint.y / Math.max(points.length, 1),
  };
  const stableAxisNudge = getStableLabelNudge(options.edgeId) * 0.7;
  const outwardSide = anchorProjection.segment.isHorizontal
    ? anchorProjection.y <= graphCenter.y
      ? -1
      : 1
    : anchorProjection.x <= graphCenter.x
      ? -1
      : 1;
  const endClearance = Math.min(
    anchorProjection.distanceFromSegmentStart,
    anchorProjection.segment.length - anchorProjection.distanceFromSegmentStart,
  );
  let bestPlacement: LabelPlacement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const side of [outwardSide, -outwardSide]) {
    for (const distance of [44, 60, 80, 102]) {
      const offsetX = anchorProjection.segment.isHorizontal ? options.laneOffset + stableAxisNudge : side * distance;
      const offsetY = anchorProjection.segment.isHorizontal ? side * distance : options.laneOffset + stableAxisNudge;
      const candidate = createLabelPlacement(anchorProjection.x, anchorProjection.y, offsetX, offsetY);
      const score = scoreLabelPlacement(
        candidate,
        labelSize,
        options.obstacleRects,
        anchorProjection.segment.length,
        side === outwardSide,
        endClearance,
      );

      if (score > bestScore) {
        bestScore = score;
        bestPlacement = candidate;
      }
    }
  }

  return bestPlacement ?? createLabelPlacement(anchorProjection.x, anchorProjection.y, options.laneOffset, -34);
}

function scoreLabelPlacement(
  placement: LabelPlacement,
  size: LabelSize,
  obstacleRects: Rect[],
  segmentLength: number,
  prefersOutwardSide: boolean,
  endClearance: number,
) {
  const labelRect = createLabelRect(placement.bubbleX, placement.bubbleY, size);
  const minClearance = obstacleRects.reduce((minimum, obstacleRect) => {
    return Math.min(minimum, getRectClearance(labelRect, obstacleRect));
  }, Number.POSITIVE_INFINITY);
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

function chooseBestLabelPlacement(points: Point[], options: LabelPlacementOptions): LabelPlacement {
  if (typeof options.anchorProgress === "number" && Number.isFinite(options.anchorProgress)) {
    return chooseLabelPlacementForFixedAnchor(points, options, options.anchorProgress);
  }

  const segments = buildSegments(points);
  if (segments.length === 0) {
    return createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, options.laneOffset, -34);
  }

  const labelSize = estimateLabelSize(options.labelText);
  const centerPoint = points.reduce(
    (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
    { x: 0, y: 0 },
  );
  const graphCenter = {
    x: centerPoint.x / points.length,
    y: centerPoint.y / points.length,
  };
  const stableAxisNudge = getStableLabelNudge(options.edgeId) * 0.7;
  const stableRatioNudge = clamp(getStableLabelNudge(options.edgeId) / 180, -0.14, 0.14);
  let bestPlacement: LabelPlacement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    const baseRatios = segment.length >= 220 ? [0.22, 0.38, 0.62, 0.78] : segment.length >= 120 ? [0.3, 0.5, 0.7] : [0.5];
    const ratios = [...new Set(baseRatios.flatMap((ratio) => [ratio, clamp(ratio + stableRatioNudge, 0.2, 0.8)]))];

    for (const ratio of ratios) {
      const anchor = getSegmentAnchor(segment, ratio);
      const endClearance = Math.min(segment.length * ratio, segment.length * (1 - ratio));
      const outwardSide = segment.isHorizontal
        ? anchor.y <= graphCenter.y
          ? -1
          : 1
        : anchor.x <= graphCenter.x
          ? -1
          : 1;

      for (const side of [outwardSide, -outwardSide]) {
        for (const distance of [44, 60, 80, 102]) {
          const offsetX = segment.isHorizontal ? options.laneOffset + stableAxisNudge : side * distance;
          const offsetY = segment.isHorizontal ? side * distance : options.laneOffset + stableAxisNudge;
          const candidate = createLabelPlacement(anchor.x, anchor.y, offsetX, offsetY);
          const score = scoreLabelPlacement(
            candidate,
            labelSize,
            options.obstacleRects,
            segment.length,
            side === outwardSide,
            endClearance,
          );

          if (score > bestScore) {
            bestScore = score;
            bestPlacement = candidate;
          }
        }
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

function getPortEdgeLane(
  edges: AppEdge[],
  edgeId: string,
  nodeId: string,
  handleId: string | undefined,
  edgeEnd: "source" | "target",
) {
  const siblingIds = edges
    .filter((edge) => {
      if (edgeEnd === "source") {
        return edge.source === nodeId && edge.sourceHandle === handleId;
      }

      return edge.target === nodeId && edge.targetHandle === handleId;
    })
    .map((edge) => edge.id)
    .sort((left, right) => left.localeCompare(right));
  const currentIndex = siblingIds.indexOf(edgeId);
  const centeredIndex = currentIndex === -1 ? 0 : currentIndex - (siblingIds.length - 1) / 2;

  return centeredIndex * 22;
}

function getParallelEdgeLane(edges: AppEdge[], edgeId: string, sourceId: string, targetId: string) {
  const pairIds = edges
    .filter(
      (edge) =>
        (edge.source === sourceId && edge.target === targetId) ||
        (edge.source === targetId && edge.target === sourceId),
    )
    .map((edge) => edge.id)
    .sort((left, right) => left.localeCompare(right));
  const currentIndex = pairIds.indexOf(edgeId);
  const centeredIndex = currentIndex === -1 ? 0 : currentIndex - (pairIds.length - 1) / 2;

  return centeredIndex * 24;
}

function getPolylineLabelPlacement(points: Point[], options: LabelPlacementOptions): LabelPlacement {
  return chooseBestLabelPlacement(points, options);
}

function getStraightLabelPlacement(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  options: LabelPlacementOptions,
): LabelPlacement {
  return chooseBestLabelPlacement(
    [
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
    ],
    options,
  );
}

type EditableSegmentHandle = {
  segmentIndex: number;
  axis: "horizontal" | "vertical";
  x: number;
  y: number;
};

function roundPoint(point: Point): Point {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function orthogonalizeStops(stops: Point[]) {
  const normalized: Point[] = [];

  for (const stop of stops) {
    const nextStop = roundPoint(stop);
    const previous = normalized[normalized.length - 1];

    if (!previous) {
      normalized.push(nextStop);
      continue;
    }

    if (Math.abs(previous.x - nextStop.x) <= 0.5 && Math.abs(previous.y - nextStop.y) <= 0.5) {
      continue;
    }

    if (Math.abs(previous.x - nextStop.x) > 0.5 && Math.abs(previous.y - nextStop.y) > 0.5) {
      const bridge = {
        x: nextStop.x,
        y: previous.y,
      };

      if (Math.abs(previous.x - bridge.x) > 0.5 || Math.abs(previous.y - bridge.y) > 0.5) {
        normalized.push(bridge);
      }
    }

    normalized.push(nextStop);
  }

  const deduped = dedupePoints(normalized);
  const collapsed: Point[] = [];

  for (const point of deduped) {
    const previous = collapsed[collapsed.length - 1];
    const beforePrevious = collapsed[collapsed.length - 2];

    if (
      beforePrevious &&
      previous &&
      ((Math.abs(beforePrevious.x - previous.x) <= 0.5 && Math.abs(previous.x - point.x) <= 0.5) ||
        (Math.abs(beforePrevious.y - previous.y) <= 0.5 && Math.abs(previous.y - point.y) <= 0.5))
    ) {
      collapsed[collapsed.length - 1] = point;
      continue;
    }

    collapsed.push(point);
  }

  return collapsed;
}

function buildManualOrthogonalPoints(
  source: Point,
  sourceOuter: Point,
  manualRoute: Point[],
  targetOuter: Point,
  target: Point,
  manualRouteMode?: RelationEdgeData["manualRouteMode"],
) {
  if (manualRouteMode === "full") {
    return orthogonalizeStops([source, ...manualRoute, target]);
  }

  return orthogonalizeStops([source, sourceOuter, ...manualRoute, targetOuter, target]);
}

function getEditableSegmentHandles(points: Point[]): EditableSegmentHandle[] {
  const handles: EditableSegmentHandle[] = [];
  const firstEditableSegmentIndex = 1;
  const lastEditableSegmentIndex = points.length - 3;

  for (let index = firstEditableSegmentIndex; index <= lastEditableSegmentIndex; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const isHorizontal = Math.abs(start.x - end.x) >= Math.abs(start.y - end.y);
    const length = Math.hypot(end.x - start.x, end.y - start.y);

    if (length < 36) {
      continue;
    }

    handles.push({
      segmentIndex: index,
      axis: isHorizontal ? "horizontal" : "vertical",
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    });
  }

  return handles;
}

function applySegmentOffset(points: Point[], segmentIndex: number, axis: "horizontal" | "vertical", nextValue: number) {
  const nextPoints = points.map((point) => ({ ...point }));

  if (!nextPoints[segmentIndex] || !nextPoints[segmentIndex + 1]) {
    return points;
  }

  if (axis === "horizontal") {
    nextPoints[segmentIndex].y = nextValue;
    nextPoints[segmentIndex + 1].y = nextValue;
  } else {
    nextPoints[segmentIndex].x = nextValue;
    nextPoints[segmentIndex + 1].x = nextValue;
  }

  return orthogonalizeStops(nextPoints);
}

function extractFullManualRoute(points: Point[]) {
  if (points.length <= 2) {
    return undefined;
  }

  const innerPoints = points.slice(1, -1).map(roundPoint);
  return innerPoints.length ? innerPoints : undefined;
}

function getRoundedPath(points: Point[], radius: number) {
  if (points.length <= 1) {
    return "";
  }

  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  let path = `M ${points[0].x},${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const previousDistance = Math.hypot(current.x - previous.x, current.y - previous.y);
    const nextDistance = Math.hypot(next.x - current.x, next.y - current.y);

    if (previousDistance === 0 || nextDistance === 0) {
      path += ` L ${current.x},${current.y}`;
      continue;
    }

    const previousRatio = Math.min(radius, previousDistance / 2) / previousDistance;
    const nextRatio = Math.min(radius, nextDistance / 2) / nextDistance;
    const entry = {
      x: current.x + (previous.x - current.x) * previousRatio,
      y: current.y + (previous.y - current.y) * previousRatio,
    };
    const exit = {
      x: current.x + (next.x - current.x) * nextRatio,
      y: current.y + (next.y - current.y) * nextRatio,
    };

    path += ` L ${entry.x},${entry.y} Q ${current.x},${current.y} ${exit.x},${exit.y}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` L ${lastPoint.x},${lastPoint.y}`;

  return path;
}

function getNodeBounds(node: AppNode | undefined): Rect | null {
  if (!node) {
    return null;
  }

  const width = node.measured?.width ?? node.width ?? node.initialWidth ?? 0;
  const height = node.measured?.height ?? node.height ?? node.initialHeight ?? 0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + width,
    bottom: node.position.y + height,
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

function isOrthogonalSegment(start: Point, end: Point) {
  return Math.abs(start.x - end.x) <= 0.5 || Math.abs(start.y - end.y) <= 0.5;
}

function getRouteLength(points: Point[]) {
  return points.slice(0, -1).reduce((total, point, index) => {
    const next = points[index + 1];
    return total + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0);
}

function getTurnCount(points: Point[]) {
  let turns = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const firstHorizontal = Math.abs(previous.y - current.y) <= 0.5;
    const secondHorizontal = Math.abs(current.y - next.y) <= 0.5;

    if (firstHorizontal !== secondHorizontal) {
      turns += 1;
    }
  }

  return turns;
}

function segmentHitsRect(start: Point, end: Point, rect: Rect) {
  if (!isOrthogonalSegment(start, end)) {
    return true;
  }

  if (Math.abs(start.x - end.x) <= 0.5) {
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    return start.x > rect.left && start.x < rect.right && maxY > rect.top && minY < rect.bottom;
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);

  return start.y > rect.top && start.y < rect.bottom && maxX > rect.left && minX < rect.right;
}

type RouteMetrics = {
  length: number;
  turns: number;
  obstaclePenalty: number;
  structurePenalty: number;
  detourPenalty: number;
  totalPenalty: number;
  score: number;
};

function getRouteDetourPenalty(points: Point[], sourceOuter: Point, targetOuter: Point) {
  const directLeft = Math.min(sourceOuter.x, targetOuter.x);
  const directRight = Math.max(sourceOuter.x, targetOuter.x);
  const directTop = Math.min(sourceOuter.y, targetOuter.y);
  const directBottom = Math.max(sourceOuter.y, targetOuter.y);

  return points.reduce((penalty, point, index) => {
    if (index === 0 || index === points.length - 1) {
      return penalty;
    }

    return (
      penalty +
      Math.max(0, directLeft - point.x) +
      Math.max(0, point.x - directRight) +
      Math.max(0, directTop - point.y) +
      Math.max(0, point.y - directBottom)
    );
  }, 0);
}

function getRouteMetrics(
  points: Point[],
  sourceRect: Rect | null,
  targetRect: Rect | null,
  obstacleRects: Rect[],
  clearance: number,
  sourceOuter: Point,
  targetOuter: Point,
): RouteMetrics {
  const expandedSource = sourceRect ? expandRect(sourceRect, Math.max(8, clearance * 0.28)) : null;
  const expandedTarget = targetRect ? expandRect(targetRect, Math.max(8, clearance * 0.28)) : null;
  const expandedObstacles = obstacleRects.map((rect) => expandRect(rect, Math.max(8, clearance * 0.14)));
  const totalDx = points[points.length - 1]?.x - points[0]?.x;
  const totalDy = points[points.length - 1]?.y - points[0]?.y;
  const turns = Math.max(getTurnCount(points), 0);
  const length = getRouteLength(points);
  const detourPenalty = getRouteDetourPenalty(points, sourceOuter, targetOuter);
  let obstaclePenalty = 0;
  let structurePenalty = turns * 340;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);

    if (!isOrthogonalSegment(start, end)) {
      structurePenalty += 20000;
      continue;
    }

    if (index > 0 && index < points.length - 2 && segmentLength < 36) {
      structurePenalty += (36 - segmentLength) * 260;
    }

    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;

    if (Math.abs(totalDx) > 24 && Math.abs(deltaX) > 8 && Math.sign(deltaX) !== Math.sign(totalDx)) {
      structurePenalty += 2200;
    }

    if (Math.abs(totalDy) > 24 && Math.abs(deltaY) > 8 && Math.sign(deltaY) !== Math.sign(totalDy)) {
      structurePenalty += 1200;
    }

    if (expandedSource && index > 0 && segmentHitsRect(start, end, expandedSource)) {
      obstaclePenalty += 12000;
    }

    if (expandedTarget && index < points.length - 2 && segmentHitsRect(start, end, expandedTarget)) {
      obstaclePenalty += 12000;
    }

    for (const obstacleRect of expandedObstacles) {
      if (segmentHitsRect(start, end, obstacleRect)) {
        obstaclePenalty += 16000;
      }
    }
  }

  const totalPenalty = obstaclePenalty + structurePenalty + detourPenalty * 24;

  return {
    length,
    turns,
    obstaclePenalty,
    structurePenalty,
    detourPenalty,
    totalPenalty,
    score: length + totalPenalty,
  };
}

function buildRoute(source: Point, sourceOuter: Point, inner: Point[], targetOuter: Point, target: Point) {
  return dedupePoints([source, sourceOuter, ...inner, targetOuter, target]);
}

function addLegacyRoute(
  source: Point,
  sourceOuter: Point,
  targetOuter: Point,
  target: Point,
  sourceSide: EdgeSide,
  targetSide: EdgeSide,
) {
  const sourceAxis = getAxis(sourceSide);
  const targetAxis = getAxis(targetSide);
  const inner: Point[] = [];

  if (sourceAxis === "horizontal" && targetAxis === "horizontal") {
    if (sourceSide === targetSide) {
      const routeX =
        sourceSide === "right"
          ? Math.max(sourceOuter.x, targetOuter.x) + Math.abs(targetOuter.x - sourceOuter.x) * 0.15 + 24
          : Math.min(sourceOuter.x, targetOuter.x) - Math.abs(targetOuter.x - sourceOuter.x) * 0.15 - 24;

      inner.push({ x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y });
    } else {
      const routeX = (sourceOuter.x + targetOuter.x) / 2;
      inner.push({ x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y });
    }
  } else if (sourceAxis === "vertical" && targetAxis === "vertical") {
    if (sourceSide === targetSide) {
      const routeY =
        sourceSide === "bottom"
          ? Math.max(sourceOuter.y, targetOuter.y) + Math.abs(targetOuter.y - sourceOuter.y) * 0.15 + 24
          : Math.min(sourceOuter.y, targetOuter.y) - Math.abs(targetOuter.y - sourceOuter.y) * 0.15 - 24;

      inner.push({ x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY });
    } else {
      const routeY = (sourceOuter.y + targetOuter.y) / 2;
      inner.push({ x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY });
    }
  } else if (sourceAxis === "horizontal") {
    const reversesOnX =
      (sourceSide === "right" && targetOuter.x < sourceOuter.x) ||
      (sourceSide === "left" && targetOuter.x > sourceOuter.x);

    if (reversesOnX) {
      const routeX =
        sourceSide === "right"
          ? Math.max(sourceOuter.x, targetOuter.x) + 24
          : Math.min(sourceOuter.x, targetOuter.x) - 24;

      inner.push({ x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y });
    } else {
      inner.push({ x: targetOuter.x, y: sourceOuter.y });
    }
  } else {
    const reversesOnY =
      (sourceSide === "bottom" && targetOuter.y < sourceOuter.y) ||
      (sourceSide === "top" && targetOuter.y > sourceOuter.y);

    if (reversesOnY) {
      const routeY =
        sourceSide === "bottom"
          ? Math.max(sourceOuter.y, targetOuter.y) + 24
          : Math.min(sourceOuter.y, targetOuter.y) - 24;

      inner.push({ x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY });
    } else {
      inner.push({ x: sourceOuter.x, y: targetOuter.y });
    }
  }

  return buildRoute(source, sourceOuter, inner, targetOuter, target);
}

function getOrthogonalPoints({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceSide,
  targetSide,
  clearance,
  laneOffset,
  sourceRect,
  targetRect,
  obstacleRects,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceSide: EdgeSide;
  targetSide: EdgeSide;
  clearance: number;
  laneOffset: number;
  sourceRect?: Rect | null;
  targetRect?: Rect | null;
  obstacleRects?: Rect[];
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceVector = getSideVector(sourceSide);
  const targetVector = getSideVector(targetSide);
  const sourceOuter = {
    x: sourceX + sourceVector.x * clearance,
    y: sourceY + sourceVector.y * clearance,
  };
  const targetOuter = {
    x: targetX + targetVector.x * clearance,
    y: targetY + targetVector.y * clearance,
  };
  const sourceAxis = getAxis(sourceSide);
  const targetAxis = getAxis(targetSide);
  const sourceBounds = sourceRect ?? null;
  const targetBounds = targetRect ?? null;
  const routeObstacles = obstacleRects ?? [];
  const routeLeft = Math.min(sourceOuter.x, targetOuter.x, sourceBounds?.left ?? sourceX, targetBounds?.left ?? targetX) - clearance;
  const routeRight = Math.max(sourceOuter.x, targetOuter.x, sourceBounds?.right ?? sourceX, targetBounds?.right ?? targetX) + clearance;
  const routeTop = Math.min(sourceOuter.y, targetOuter.y, sourceBounds?.top ?? sourceY, targetBounds?.top ?? targetY) - clearance;
  const routeBottom = Math.max(sourceOuter.y, targetOuter.y, sourceBounds?.bottom ?? sourceY, targetBounds?.bottom ?? targetY) + clearance;
  const midX = (sourceOuter.x + targetOuter.x) / 2;
  const midY = (sourceOuter.y + targetOuter.y) / 2;
  const effectiveLaneOffset = clamp(laneOffset, -56, 56);
  const candidates: Point[][] = [];
  const seen = new Set<string>();

  const addCandidate = (inner: Point[]) => {
    const route = buildRoute(source, sourceOuter, inner, targetOuter, target);
    const signature = route.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`).join("|");

    if (!seen.has(signature)) {
      seen.add(signature);
      candidates.push(route);
    }
  };

  const addVerticalCorridor = (routeX: number) => {
    addCandidate([
      { x: routeX, y: sourceOuter.y },
      { x: routeX, y: targetOuter.y },
    ]);
  };

  const addHorizontalCorridor = (routeY: number) => {
    addCandidate([
      { x: sourceOuter.x, y: routeY },
      { x: targetOuter.x, y: routeY },
    ]);
  };

  addCandidate([]);
  addCandidate(addLegacyRoute(source, sourceOuter, targetOuter, target, sourceSide, targetSide).slice(2, -2));
  addCandidate([{ x: targetOuter.x, y: sourceOuter.y }]);
  addCandidate([{ x: sourceOuter.x, y: targetOuter.y }]);

  if (sourceAxis !== targetAxis) {
    addCandidate([{ x: midX, y: sourceOuter.y }, { x: midX, y: targetOuter.y }]);
    addCandidate([{ x: sourceOuter.x, y: midY }, { x: targetOuter.x, y: midY }]);
  }

  addVerticalCorridor(midX);
  addHorizontalCorridor(midY);
  addVerticalCorridor(routeLeft);
  addVerticalCorridor(routeRight);
  addHorizontalCorridor(routeTop);
  addHorizontalCorridor(routeBottom);

  if (Math.abs(effectiveLaneOffset) >= 6) {
    addVerticalCorridor(midX + effectiveLaneOffset);
    addHorizontalCorridor(midY + effectiveLaneOffset);
    addCandidate([
      { x: sourceOuter.x + effectiveLaneOffset, y: sourceOuter.y },
      { x: sourceOuter.x + effectiveLaneOffset, y: targetOuter.y },
    ]);
    addCandidate([
      { x: sourceOuter.x, y: sourceOuter.y + effectiveLaneOffset },
      { x: targetOuter.x, y: sourceOuter.y + effectiveLaneOffset },
    ]);
    addCandidate([
      { x: targetOuter.x + effectiveLaneOffset, y: sourceOuter.y },
      { x: targetOuter.x + effectiveLaneOffset, y: targetOuter.y },
    ]);
    addCandidate([
      { x: sourceOuter.x, y: targetOuter.y + effectiveLaneOffset },
      { x: targetOuter.x, y: targetOuter.y + effectiveLaneOffset },
    ]);
  }

  if (sourceAxis === "horizontal") {
    addVerticalCorridor(sourceSide === "right" ? routeRight : routeLeft);
  } else {
    addHorizontalCorridor(sourceSide === "bottom" ? routeBottom : routeTop);
  }

  if (targetAxis === "horizontal") {
    addVerticalCorridor(targetSide === "right" ? routeRight : routeLeft);
  } else {
    addHorizontalCorridor(targetSide === "bottom" ? routeBottom : routeTop);
  }

  const rankedCandidates = candidates.map((route) => ({
    route,
    metrics: getRouteMetrics(route, sourceBounds, targetBounds, routeObstacles, clearance, sourceOuter, targetOuter),
  }));
  const clearCandidates = rankedCandidates.filter((candidate) => candidate.metrics.obstaclePenalty === 0);
  const preferredCandidates = clearCandidates.length > 0 ? clearCandidates : rankedCandidates;

  return (
    preferredCandidates.sort((left, right) => {
      if (left.metrics.turns !== right.metrics.turns) {
        return left.metrics.turns - right.metrics.turns;
      }

      if (left.metrics.detourPenalty !== right.metrics.detourPenalty) {
        return left.metrics.detourPenalty - right.metrics.detourPenalty;
      }

      if (left.metrics.length !== right.metrics.length) {
        return left.metrics.length - right.metrics.length;
      }

      return left.metrics.score - right.metrics.score;
    })[0]?.route ?? buildRoute(source, sourceOuter, [], targetOuter, target)
  );
}

function announceEdgeLabelSelection(edgeId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent("icvn:select-edge-label", { detail: { edgeId } }));
}

function dispatchHistoryGesture(eventName: "icvn:begin-history-gesture" | "icvn:end-history-gesture") {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName));
}

export function RelationEdge({
  data,
  id,
  label,
  markerEnd,
  selected,
  source,
  sourceX,
  sourceY,
  sourceHandleId,
  sourcePosition,
  style,
  target,
  targetX,
  targetY,
  targetHandleId,
  targetPosition,
}: EdgeProps<AppEdge>) {
  const edgeData = data as RelationEdgeData;
  const edgeLabel = typeof label === "string" ? label.trim() : "";
  const { getEdges, getNode, getNodes, getViewport, screenToFlowPosition, setEdges } = useReactFlow<AppNode, AppEdge>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(edgeLabel);
  const [isLabelSelected, setIsLabelSelected] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelAnchorDragStateRef = useRef<{
    pointerId: number;
    pointerHost: HTMLButtonElement | null;
    cleanup: (() => void) | null;
  } | null>(null);
  const segmentDragStateRef = useRef<{
    pointerId: number;
    segmentIndex: number;
    axis: "horizontal" | "vertical";
    startFlowX: number;
    startFlowY: number;
    startPoints: Point[];
    pointerHost: HTMLButtonElement | null;
    cleanup: (() => void) | null;
  } | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(edgeLabel);
    }
  }, [editing, edgeLabel]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleSelectLabel = (event: Event) => {
      const detail = (event as CustomEvent<{ edgeId?: string }>).detail;
      setIsLabelSelected(detail?.edgeId === id);
    };

    const handleClearLabelSelection = () => {
      setIsLabelSelected(false);
    };

    window.addEventListener("icvn:select-edge-label", handleSelectLabel as EventListener);
    window.addEventListener("icvn:clear-edge-label-selection", handleClearLabelSelection);

    return () => {
      window.removeEventListener("icvn:select-edge-label", handleSelectLabel as EventListener);
      window.removeEventListener("icvn:clear-edge-label-selection", handleClearLabelSelection);
    };
  }, [id]);

  const edgeDistance = Math.hypot(targetX - sourceX, targetY - sourceY);
  const routeClearance = clamp(edgeDistance * 0.18, 28, 60);
  const routeRadius = clamp(edgeDistance * 0.05, 10, 18);
  const sourceSide = parseHandleSide(sourceHandleId, sourcePosition);
  const targetSide = parseHandleSide(targetHandleId, targetPosition);
  const sourceRect = getNodeBounds(getNode(source));
  const targetRect = getNodeBounds(getNode(target));
  const routeObstacleRects = getNodes()
    .filter((node) => node.id !== source && node.id !== target && node.type === "shapeNode")
    .map((node) => getNodeBounds(node))
    .filter((rect): rect is Rect => Boolean(rect));
  const labelObstacleRects = [sourceRect, targetRect, ...routeObstacleRects]
    .filter((rect): rect is Rect => Boolean(rect))
    .map((rect) => expandRect(rect, 14));
  const allEdges = getEdges();
  const incidentLaneOffset = getIncidentEdgeLane(allEdges, id, source, target);
  const routeLaneOffset = clamp(
    getPortEdgeLane(allEdges, id, source, sourceHandleId ?? undefined, "source") +
      getPortEdgeLane(allEdges, id, target, targetHandleId ?? undefined, "target") +
      getParallelEdgeLane(allEdges, id, source, target),
    -56,
    56,
  );
  const sourceVector = getSideVector(sourceSide);
  const targetVector = getSideVector(targetSide);
  const sourcePoint = { x: sourceX, y: sourceY };
  const targetPoint = { x: targetX, y: targetY };
  const sourceOuter = {
    x: sourceX + sourceVector.x * routeClearance,
    y: sourceY + sourceVector.y * routeClearance,
  };
  const targetOuter = {
    x: targetX + targetVector.x * routeClearance,
    y: targetY + targetVector.y * routeClearance,
  };
  const autoOrthogonalPoints = getOrthogonalPoints({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceSide,
    targetSide,
    clearance: routeClearance,
    laneOffset: routeLaneOffset,
    sourceRect,
    targetRect,
    obstacleRects: routeObstacleRects,
  });
  const orthogonalPoints =
    edgeData.manualRoute && edgeData.manualRoute.length > 0
      ? buildManualOrthogonalPoints(
          sourcePoint,
          sourceOuter,
          edgeData.manualRoute,
          targetOuter,
          targetPoint,
          edgeData.manualRouteMode,
        )
      : autoOrthogonalPoints;
  const editableSegmentHandles =
    selected && edgeData.pathStyle !== "straight" ? getEditableSegmentHandles(orthogonalPoints) : [];
  const edgePath =
    edgeData.pathStyle === "straight"
      ? getStraightPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
        })[0]
      : edgeData.pathStyle === "step"
        ? `M ${orthogonalPoints.map((point) => `${point.x},${point.y}`).join(" L ")}`
        : getRoundedPath(orthogonalPoints, routeRadius);
  const labelPathPoints = edgeData.pathStyle === "straight" ? [sourcePoint, targetPoint] : orthogonalPoints;
  const effectiveLabelAnchorPosition =
    edgeData.labelPlacementMode === "manual" &&
    typeof edgeData.labelAnchorPosition === "number" &&
    Number.isFinite(edgeData.labelAnchorPosition)
      ? clamp(edgeData.labelAnchorPosition, 0, 1)
      : 0.5;
  const getBaseLabelPlacement = (anchorProgress = effectiveLabelAnchorPosition) =>
    edgeData.pathStyle === "straight"
      ? getStraightLabelPlacement(sourceX, sourceY, targetX, targetY, {
          edgeId: id,
          labelText: edgeLabel,
          obstacleRects: labelObstacleRects,
          laneOffset: incidentLaneOffset,
          anchorProgress,
        })
      : getPolylineLabelPlacement(labelPathPoints, {
          edgeId: id,
          labelText: edgeLabel,
          obstacleRects: labelObstacleRects,
          laneOffset: incidentLaneOffset,
          anchorProgress,
        });
  const labelPlacement = getBaseLabelPlacement();

  const commitLabel = () => {
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === id
          ? {
              ...edge,
              label: draft.trim(),
            }
          : edge,
      ),
    );
    setEditing(false);
  };

  const handleSelectLabel = () => {
    announceEdgeLabelSelection(id);
  };

  const getPointerFlowPosition = (clientX: number, clientY: number) => {
    if (typeof screenToFlowPosition === "function") {
      return screenToFlowPosition({ x: clientX, y: clientY });
    }

    const viewport = getViewport();
    const zoom = viewport.zoom || 1;

    return {
      x: clientX / zoom,
      y: clientY / zoom,
    };
  };

  const persistLabelPlacement = (nextLabelAnchorPosition: number | undefined = effectiveLabelAnchorPosition) => {
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === id
          ? createRelationEdge({
              ...edge,
              id: edge.id,
              label: typeof edge.label === "string" ? edge.label : "",
              data: {
                pathStyle: edge.data?.pathStyle ?? "smoothstep",
                dashed: edge.data?.dashed ?? false,
                marker: edge.data?.marker ?? "arrow",
                color: edge.data?.color ?? "#64748b",
                labelOffset: {
                  x: 0,
                  y: 0,
                },
                labelAnchorPosition:
                  typeof nextLabelAnchorPosition === "number" && Number.isFinite(nextLabelAnchorPosition)
                    ? clamp(nextLabelAnchorPosition, 0, 1)
                    : undefined,
                labelPlacementMode: "manual",
                manualRoute: edge.data?.manualRoute,
                manualRouteMode: edge.data?.manualRouteMode,
              },
            })
          : edge,
      ),
    );
  };

  const persistManualRoute = (
    manualRoute: Point[] | undefined,
    manualRouteMode: RelationEdgeData["manualRouteMode"] = edgeData.manualRouteMode,
  ) => {
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === id
          ? createRelationEdge({
              ...edge,
              id: edge.id,
              label: typeof edge.label === "string" ? edge.label : "",
              data: {
                pathStyle: edge.data?.pathStyle ?? "smoothstep",
                dashed: edge.data?.dashed ?? false,
                marker: edge.data?.marker ?? "arrow",
                color: edge.data?.color ?? "#64748b",
                labelOffset: edge.data?.labelOffset,
                labelAnchorPosition: edge.data?.labelAnchorPosition,
                labelPlacementMode: edge.data?.labelPlacementMode,
                manualRoute: manualRoute?.map(roundPoint),
                manualRouteMode,
              },
            })
          : edge,
      ),
    );
  };

  const handleSegmentHandlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: EditableSegmentHandle,
  ) => {
    if (event.button !== 0 || typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pointerHost = event.currentTarget;
    const nextState = {
      pointerId: event.pointerId,
      segmentIndex: handle.segmentIndex,
      axis: handle.axis,
      startFlowX: getPointerFlowPosition(event.clientX, event.clientY).x,
      startFlowY: getPointerFlowPosition(event.clientX, event.clientY).y,
      startPoints: orthogonalPoints.map((point) => ({ ...point })),
      pointerHost,
      cleanup: null as (() => void) | null,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = segmentDragStateRef.current;
      if (!state || moveEvent.pointerId !== state.pointerId) {
        return;
      }

      moveEvent.preventDefault();
      const pointerFlowPosition = getPointerFlowPosition(moveEvent.clientX, moveEvent.clientY);
      const delta =
        state.axis === "horizontal"
          ? pointerFlowPosition.y - state.startFlowY
          : pointerFlowPosition.x - state.startFlowX;
      const anchorPoint = state.startPoints[state.segmentIndex];
      const nextValue = Math.round(
        (state.axis === "horizontal" ? anchorPoint.y : anchorPoint.x) + delta,
      );
      const nextRoutePoints = applySegmentOffset(state.startPoints, state.segmentIndex, state.axis, nextValue);
      persistManualRoute(extractFullManualRoute(nextRoutePoints), "full");
    };

    const finishDragging = (finishEvent: PointerEvent) => {
      const state = segmentDragStateRef.current;
      if (!state || finishEvent.pointerId !== state.pointerId) {
        return;
      }

      state.cleanup?.();
      segmentDragStateRef.current = null;
      dispatchHistoryGesture("icvn:end-history-gesture");
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDragging);
      window.removeEventListener("pointercancel", finishDragging);

      if (pointerHost.hasPointerCapture?.(event.pointerId)) {
        pointerHost.releasePointerCapture(event.pointerId);
      }
    };

    nextState.cleanup = cleanup;
    segmentDragStateRef.current = nextState;
    pointerHost.setPointerCapture?.(event.pointerId);
    dispatchHistoryGesture("icvn:begin-history-gesture");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDragging);
    window.addEventListener("pointercancel", finishDragging);
  };

  const handleLabelAnchorPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (editing || event.button !== 0 || typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleSelectLabel();

    const pointerHost = event.currentTarget;
    const nextState = {
      pointerId: event.pointerId,
      pointerHost,
      cleanup: null as (() => void) | null,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = labelAnchorDragStateRef.current;
      if (!state || moveEvent.pointerId !== state.pointerId) {
        return;
      }

      moveEvent.preventDefault();
      const pointerFlowPosition = getPointerFlowPosition(moveEvent.clientX, moveEvent.clientY);
      const nextProjection = projectPointOntoPolyline(labelPathPoints, pointerFlowPosition);

      if (!nextProjection) {
        return;
      }

      persistLabelPlacement(nextProjection.progress);
    };

    const finishDragging = (finishEvent: PointerEvent) => {
      const state = labelAnchorDragStateRef.current;
      if (!state || finishEvent.pointerId !== state.pointerId) {
        return;
      }

      state.cleanup?.();
      labelAnchorDragStateRef.current = null;
      dispatchHistoryGesture("icvn:end-history-gesture");
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDragging);
      window.removeEventListener("pointercancel", finishDragging);

      if (pointerHost.hasPointerCapture?.(event.pointerId)) {
        pointerHost.releasePointerCapture(event.pointerId);
      }
    };

    nextState.cleanup = cleanup;
    labelAnchorDragStateRef.current = nextState;
    pointerHost.setPointerCapture?.(event.pointerId);
    dispatchHistoryGesture("icvn:begin-history-gesture");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDragging);
    window.addEventListener("pointercancel", finishDragging);
  };

  useEffect(() => {
    return () => {
      labelAnchorDragStateRef.current?.cleanup?.();
      segmentDragStateRef.current?.cleanup?.();
    };
  }, []);

  const beginEditing = () => {
    labelAnchorDragStateRef.current?.cleanup?.();
    labelAnchorDragStateRef.current = null;
    handleSelectLabel();
    setEditing(true);
  };

  const showBubble = editing || selected || isLabelSelected || edgeLabel.length > 0;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      {showBubble || editableSegmentHandles.length > 0 ? (
        <EdgeLabelRenderer>
          {editableSegmentHandles.map((handle) => (
            <button
              key={`${id}-segment-${handle.segmentIndex}`}
              type="button"
              className="nodrag nopan pointer-events-auto absolute z-[70] flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-sky-300 bg-white/96 shadow-[0_10px_24px_-16px_rgba(37,99,235,0.75)] hover:scale-105"
              style={{
                transform: `translate(-50%, -50%) translate(${handle.x}px, ${handle.y}px)`,
                cursor: handle.axis === "horizontal" ? "row-resize" : "col-resize",
              }}
              onPointerDown={(event) => handleSegmentHandlePointerDown(event, handle)}
              onClick={(event) => event.stopPropagation()}
            >
              <span
                className={cn(
                  "rounded-full bg-sky-500",
                  handle.axis === "horizontal" ? "h-[2px] w-2.5" : "h-2.5 w-[2px]",
                )}
              />
            </button>
          ))}
          {showBubble ? (
            <div
              className="absolute z-[85]"
              style={{
                left: labelPlacement.anchorX,
                top: labelPlacement.anchorY,
                transform: "translate(-50%, -50%)",
              }}
            >
              {editing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  placeholder="输入连线说明"
                  className="nodrag nopan pointer-events-auto w-44 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-center text-xs leading-5 text-slate-700 outline-none ring-2 ring-sky-100"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitLabel}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDraft(edgeLabel);
                      setEditing(false);
                      return;
                    }

                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitLabel();
                    }
                  }}
                />
              ) : (
                <div className="nodrag nopan pointer-events-auto w-fit max-w-[280px]">
                  <button
                    type="button"
                    aria-label={edgeLabel ? `编辑并沿线拖动说明：${edgeLabel}` : "双击编辑说明，沿线拖动可调整位置"}
                    className={cn(
                      "max-w-[280px] cursor-grab rounded-md bg-white px-2.5 py-1 text-center text-xs font-medium leading-5 transition active:cursor-grabbing",
                      edgeLabel ? "w-max" : "min-w-[112px]",
                      selected || isLabelSelected
                        ? "text-sky-700 outline outline-1 outline-sky-300"
                        : "text-slate-600 hover:text-slate-700",
                    )}
                    onPointerDown={handleLabelAnchorPointerDown}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectLabel();
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginEditing();
                    }}
                  >
                    <span className={cn("block whitespace-pre-wrap break-words text-center leading-5", !edgeLabel && "text-slate-400")}>
                      {edgeLabel || "双击编辑，沿线拖动"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
