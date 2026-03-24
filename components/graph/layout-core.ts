import { getTextVisualUnits, type ShapeHandleId } from "./sample-graph";

export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type LabelSize = {
  width: number;
  height: number;
  area: number;
};

export type LabelPlacement = {
  anchorX: number;
  anchorY: number;
  bubbleX: number;
  bubbleY: number;
  connectorLength: number;
  connectorAngle: number;
};

export type RouteSegment = {
  start: Point;
  end: Point;
  length: number;
  angle: number;
  cumulativeStart: number;
  cumulativeEnd: number;
};

export type PolylineProjection = {
  x: number;
  y: number;
  progress: number;
  segment: RouteSegment;
  segmentRatio: number;
  distanceFromSegmentStart: number;
};

export type SmartLabelPlacementOptions = {
  edgeId: string;
  labelText: string;
  obstacleRects: Rect[];
  laneOffset: number;
  anchorProgress?: number;
};

export type SmartRouteOptions = {
  sourcePoint: Point;
  targetPoint: Point;
  sourceSide: ShapeHandleId;
  targetSide: ShapeHandleId;
  clearance: number;
  laneOffset: number;
  sourceRect?: Rect | null;
  targetRect?: Rect | null;
  obstacleRects?: Rect[];
  manualRoute?: Point[];
  manualRouteMode?: "inner" | "full";
};

type RouteCandidate = {
  kind: "direct" | "single-bend" | "center" | "outer" | "manual";
  points: Point[];
  score: number;
};

const HANDLE_VECTORS: Record<ShapeHandleId, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function roundPoint(point: Point): Point {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

export function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };
}

export function createLabelPlacement(anchorX: number, anchorY: number, offsetX: number, offsetY: number): LabelPlacement {
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

export function applyLabelOffset(placement: LabelPlacement, offsetX = 0, offsetY = 0): LabelPlacement {
  return createLabelPlacement(
    placement.anchorX,
    placement.anchorY,
    placement.bubbleX - placement.anchorX + offsetX,
    placement.bubbleY - placement.anchorY + offsetY,
  );
}

export function createLabelRect(centerX: number, centerY: number, size: LabelSize): Rect {
  return {
    left: centerX - size.width / 2,
    top: centerY - size.height / 2,
    right: centerX + size.width / 2,
    bottom: centerY + size.height / 2,
  };
}

export function getRectClearance(first: Rect, second: Rect) {
  const dx = Math.max(second.left - first.right, first.left - second.right, 0);
  const dy = Math.max(second.top - first.bottom, first.top - second.bottom, 0);

  if (dx === 0 && dy === 0) {
    const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
    const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
    return -Math.min(overlapX, overlapY);
  }

  return Math.hypot(dx, dy);
}

export function getMinimumRectClearance(rect: Rect, obstacles: Rect[]) {
  if (obstacles.length === 0) {
    return 96;
  }

  return obstacles.reduce((minimum, obstacle) => Math.min(minimum, getRectClearance(rect, obstacle)), Number.POSITIVE_INFINITY);
}

function crossProduct(from: Point, through: Point, to: Point) {
  return (through.x - from.x) * (to.y - through.y) - (through.y - from.y) * (to.x - through.x);
}

export function normalizeRoutePoints(points: Point[]) {
  const rounded = points.map(roundPoint).filter((point, index, array) => {
    const previous = array[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });

  const normalized: Point[] = [];

  for (const point of rounded) {
    const previous = normalized[normalized.length - 1];
    const beforePrevious = normalized[normalized.length - 2];

    if (!previous || !beforePrevious) {
      normalized.push(point);
      continue;
    }

    if (Math.abs(crossProduct(beforePrevious, previous, point)) <= 0.5) {
      normalized[normalized.length - 1] = point;
      continue;
    }

    normalized.push(point);
  }

  return normalized;
}

function segmentIntersectsRect(start: Point, end: Point, rect: Rect) {
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

function getPolylineBounds(points: Point[]) {
  return points.reduce(
    (bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x),
      bottom: Math.max(bounds.bottom, point.y),
    }),
    { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY },
  );
}

function getRouteLength(points: Point[]) {
  return points.slice(0, -1).reduce((total, point, index) => total + Math.hypot(points[index + 1].x - point.x, points[index + 1].y - point.y), 0);
}

function getTurnCount(points: Point[]) {
  let turns = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const firstAngle = Math.atan2(current.y - previous.y, current.x - previous.x);
    const secondAngle = Math.atan2(next.y - current.y, next.x - current.x);

    if (Math.abs(firstAngle - secondAngle) > 0.08) {
      turns += 1;
    }
  }

  return turns;
}

function getRouteObstaclePenalty(points: Point[], obstacleRects: Rect[], padding: number) {
  let penalty = 0;
  const expandedObstacles = obstacleRects.map((rect) => expandRect(rect, padding));

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    for (const rect of expandedObstacles) {
      if (segmentIntersectsRect(start, end, rect)) {
        penalty += 20000;
      }
    }
  }

  return penalty;
}

function getRouteOuterPenalty(points: Point[], sourcePoint: Point, targetPoint: Point, allowance: number) {
  const directLeft = Math.min(sourcePoint.x, targetPoint.x) - allowance;
  const directRight = Math.max(sourcePoint.x, targetPoint.x) + allowance;
  const directTop = Math.min(sourcePoint.y, targetPoint.y) - allowance;
  const directBottom = Math.max(sourcePoint.y, targetPoint.y) + allowance;

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

function scoreRouteCandidate(
  kind: RouteCandidate["kind"],
  points: Point[],
  sourcePoint: Point,
  targetPoint: Point,
  obstacleRects: Rect[],
  clearance: number,
) {
  const routeLength = getRouteLength(points);
  const turnCount = getTurnCount(points);
  const obstaclePenalty = getRouteObstaclePenalty(points, obstacleRects, Math.max(18, clearance * 0.24));
  const outerPenalty = getRouteOuterPenalty(points, sourcePoint, targetPoint, Math.max(72, clearance * 0.8));
  const directDistance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
  const detourPenalty = Math.max(0, routeLength - directDistance) * 1.35;
  const kindPenalty = kind === "direct" ? -220 : kind === "single-bend" ? -96 : kind === "center" ? 0 : kind === "manual" ? -120 : 82;

  return routeLength + turnCount * 180 + detourPenalty + outerPenalty * 1.2 + obstaclePenalty + kindPenalty;
}

function getSideVector(side: ShapeHandleId) {
  return HANDLE_VECTORS[side];
}

function offsetFromHandle(point: Point, side: ShapeHandleId, clearance: number) {
  const vector = getSideVector(side);
  return {
    x: point.x + vector.x * clearance,
    y: point.y + vector.y * clearance,
  };
}

function pushRouteCandidate(
  candidates: RouteCandidate[],
  seen: Set<string>,
  kind: RouteCandidate["kind"],
  points: Point[],
  sourcePoint: Point,
  targetPoint: Point,
  obstacleRects: Rect[],
  clearance: number,
) {
  const normalizedPoints = normalizeRoutePoints(points);
  const signature = normalizedPoints.map((point) => `${point.x}:${point.y}`).join("|");

  if (normalizedPoints.length < 2 || seen.has(signature)) {
    return;
  }

  seen.add(signature);
  candidates.push({
    kind,
    points: normalizedPoints,
    score: scoreRouteCandidate(kind, normalizedPoints, sourcePoint, targetPoint, obstacleRects, clearance),
  });
}

export function buildSmartEdgeRoute(options: SmartRouteOptions): Point[] {
  const sourceOuter = offsetFromHandle(options.sourcePoint, options.sourceSide, options.clearance);
  const targetOuter = offsetFromHandle(options.targetPoint, options.targetSide, options.clearance);

  if (options.manualRoute && options.manualRoute.length > 0) {
    return normalizeRoutePoints(
      options.manualRouteMode === "full"
        ? [options.sourcePoint, ...options.manualRoute, options.targetPoint]
        : [options.sourcePoint, sourceOuter, ...options.manualRoute, targetOuter, options.targetPoint],
    );
  }

  const obstacleRects = options.obstacleRects ?? [];
  const laneOffset = clamp(options.laneOffset, -120, 120);
  const routeLeft = Math.min(options.sourcePoint.x, options.targetPoint.x, sourceOuter.x, targetOuter.x) - options.clearance;
  const routeRight = Math.max(options.sourcePoint.x, options.targetPoint.x, sourceOuter.x, targetOuter.x) + options.clearance;
  const routeTop = Math.min(options.sourcePoint.y, options.targetPoint.y, sourceOuter.y, targetOuter.y) - options.clearance;
  const routeBottom = Math.max(options.sourcePoint.y, options.targetPoint.y, sourceOuter.y, targetOuter.y) + options.clearance;
  const midX = (sourceOuter.x + targetOuter.x) / 2;
  const midY = (sourceOuter.y + targetOuter.y) / 2;
  const candidates: RouteCandidate[] = [];
  const seen = new Set<string>();
  const sparseEnoughForStraight = obstacleRects.length <= 1;

  if (Math.abs(laneOffset) <= 10 || sparseEnoughForStraight) {
    pushRouteCandidate(
      candidates,
      seen,
      "direct",
      [options.sourcePoint, options.targetPoint],
      options.sourcePoint,
      options.targetPoint,
      obstacleRects,
      options.clearance,
    );
  }

  pushRouteCandidate(
    candidates,
    seen,
    "direct",
    [options.sourcePoint, sourceOuter, targetOuter, options.targetPoint],
    options.sourcePoint,
    options.targetPoint,
    obstacleRects,
    options.clearance,
  );

  pushRouteCandidate(
    candidates,
    seen,
    "single-bend",
    [options.sourcePoint, sourceOuter, { x: targetOuter.x, y: sourceOuter.y }, targetOuter, options.targetPoint],
    options.sourcePoint,
    options.targetPoint,
    obstacleRects,
    options.clearance,
  );
  pushRouteCandidate(
    candidates,
    seen,
    "single-bend",
    [options.sourcePoint, sourceOuter, { x: sourceOuter.x, y: targetOuter.y }, targetOuter, options.targetPoint],
    options.sourcePoint,
    options.targetPoint,
    obstacleRects,
    options.clearance,
  );

  pushRouteCandidate(
    candidates,
    seen,
    "center",
    [options.sourcePoint, sourceOuter, { x: midX, y: sourceOuter.y }, { x: midX, y: targetOuter.y }, targetOuter, options.targetPoint],
    options.sourcePoint,
    options.targetPoint,
    obstacleRects,
    options.clearance,
  );
  pushRouteCandidate(
    candidates,
    seen,
    "center",
    [options.sourcePoint, sourceOuter, { x: sourceOuter.x, y: midY }, { x: targetOuter.x, y: midY }, targetOuter, options.targetPoint],
    options.sourcePoint,
    options.targetPoint,
    obstacleRects,
    options.clearance,
  );

  if (Math.abs(laneOffset) >= 8) {
    pushRouteCandidate(
      candidates,
      seen,
      "center",
      [
        options.sourcePoint,
        sourceOuter,
        { x: midX + laneOffset, y: sourceOuter.y },
        { x: midX + laneOffset, y: targetOuter.y },
        targetOuter,
        options.targetPoint,
      ],
      options.sourcePoint,
      options.targetPoint,
      obstacleRects,
      options.clearance,
    );
    pushRouteCandidate(
      candidates,
      seen,
      "center",
      [
        options.sourcePoint,
        sourceOuter,
        { x: sourceOuter.x, y: midY + laneOffset },
        { x: targetOuter.x, y: midY + laneOffset },
        targetOuter,
        options.targetPoint,
      ],
      options.sourcePoint,
      options.targetPoint,
      obstacleRects,
      options.clearance,
    );
  }

  for (const routeX of [routeLeft, routeRight, midX]) {
    pushRouteCandidate(
      candidates,
      seen,
      routeX === midX ? "center" : "outer",
      [options.sourcePoint, sourceOuter, { x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y }, targetOuter, options.targetPoint],
      options.sourcePoint,
      options.targetPoint,
      obstacleRects,
      options.clearance,
    );
  }

  for (const routeY of [routeTop, routeBottom, midY]) {
    pushRouteCandidate(
      candidates,
      seen,
      routeY === midY ? "center" : "outer",
      [options.sourcePoint, sourceOuter, { x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY }, targetOuter, options.targetPoint],
      options.sourcePoint,
      options.targetPoint,
      obstacleRects,
      options.clearance,
    );
  }

  for (const obstacleRect of obstacleRects) {
    for (const routeX of [obstacleRect.left - options.clearance, obstacleRect.right + options.clearance]) {
      pushRouteCandidate(
        candidates,
        seen,
        "outer",
        [options.sourcePoint, sourceOuter, { x: routeX, y: sourceOuter.y }, { x: routeX, y: targetOuter.y }, targetOuter, options.targetPoint],
        options.sourcePoint,
        options.targetPoint,
        obstacleRects,
        options.clearance,
      );
    }

    for (const routeY of [obstacleRect.top - options.clearance, obstacleRect.bottom + options.clearance]) {
      pushRouteCandidate(
        candidates,
        seen,
        "outer",
        [options.sourcePoint, sourceOuter, { x: sourceOuter.x, y: routeY }, { x: targetOuter.x, y: routeY }, targetOuter, options.targetPoint],
        options.sourcePoint,
        options.targetPoint,
        obstacleRects,
        options.clearance,
      );
    }
  }

  return candidates.sort((left, right) => left.score - right.score)[0]?.points ?? normalizeRoutePoints([options.sourcePoint, options.targetPoint]);
}

export function buildRouteSegments(points: Point[]): RouteSegment[] {
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
      angle: Math.atan2(deltaY, deltaX),
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

export function getPolylinePointAtProgress(points: Point[], progress: number): PolylineProjection | null {
  const routeSegments = buildRouteSegments(points);
  const totalLength = routeSegments[routeSegments.length - 1]?.cumulativeEnd ?? 0;

  if (routeSegments.length === 0 || totalLength <= 0) {
    return null;
  }

  const normalizedProgress = clamp(progress, 0, 1);
  const targetDistance = totalLength * normalizedProgress;
  const segment = routeSegments.find((item) => targetDistance >= item.cumulativeStart && targetDistance <= item.cumulativeEnd)
    ?? routeSegments[routeSegments.length - 1];
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

export function projectPointOntoPolyline(points: Point[], point: Point): PolylineProjection | null {
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

function getStableLabelNudge(value: string) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }

  return ((hash % 5) - 2) * 12;
}

export function estimateEdgeLabelSize(labelText: string): LabelSize {
  const normalizedLabel = labelText.trim().length > 0 ? labelText : "未命名说明";
  const lines = normalizedLabel
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const longestLineUnits = lines.reduce((max, line) => Math.max(max, getTextVisualUnits(line)), 0);
  const lineCount = Math.max(lines.length, 1);
  const width = clamp(Math.ceil(longestLineUnits * 13 + 48), 84, 240);
  const height = clamp(lineCount * 22 + 14, 36, 112);

  return {
    width,
    height,
    area: width * height,
  };
}

function getPlacementCenter(points: Point[], obstacleRects: Rect[]) {
  if (obstacleRects.length > 0) {
    const bounds = obstacleRects.reduce(
      (accumulator, rect) => ({
        left: Math.min(accumulator.left, rect.left),
        top: Math.min(accumulator.top, rect.top),
        right: Math.max(accumulator.right, rect.right),
        bottom: Math.max(accumulator.bottom, rect.bottom),
      }),
      { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY },
    );

    if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top) && Number.isFinite(bounds.right) && Number.isFinite(bounds.bottom)) {
      return {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      };
    }
  }

  const bounds = getPolylineBounds(points);
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
}

function scoreLabelPlacement(
  placement: LabelPlacement,
  size: LabelSize,
  obstacleRects: Rect[],
  prefersOutwardSide: boolean,
  drift: number,
) {
  const labelRect = createLabelRect(placement.bubbleX, placement.bubbleY, size);
  const safeClearance = getMinimumRectClearance(labelRect, obstacleRects);
  const overlapPenalty = safeClearance < 0 ? Math.abs(safeClearance) * 200 : 0;
  const nearPenalty = safeClearance >= 0 && safeClearance < 26 ? (26 - safeClearance) * 20 : 0;

  return (
    safeClearance * 28 +
    (prefersOutwardSide ? 18 : 0) -
    placement.connectorLength * 0.7 -
    drift * 0.18 -
    overlapPenalty -
    nearPenalty
  );
}

function buildLabelPlacementCandidates(
  projection: PolylineProjection,
  placementCenter: Point,
  laneOffset: number,
  stableAxisNudge: number,
) {
  const tangent = {
    x: Math.cos(projection.segment.angle),
    y: Math.sin(projection.segment.angle),
  };
  const normal = {
    x: -tangent.y,
    y: tangent.x,
  };
  const anchorVector = {
    x: projection.x - placementCenter.x,
    y: projection.y - placementCenter.y,
  };
  const outwardSide = anchorVector.x * normal.x + anchorVector.y * normal.y >= 0 ? 1 : -1;
  const candidates: Array<{ placement: LabelPlacement; prefersOutwardSide: boolean; drift: number }> = [];

  for (const side of [outwardSide, -outwardSide]) {
    for (const distance of [24, 36, 52, 72, 96, 124, 156]) {
      for (const tangentOffset of [stableAxisNudge, stableAxisNudge - 18, stableAxisNudge + 18, stableAxisNudge - 42, stableAxisNudge + 42]) {
        const offsetX = normal.x * side * distance + tangent.x * (laneOffset * 0.24 + tangentOffset);
        const offsetY = normal.y * side * distance + tangent.y * (laneOffset * 0.24 + tangentOffset);

        candidates.push({
          placement: createLabelPlacement(projection.x, projection.y, offsetX, offsetY),
          prefersOutwardSide: side === outwardSide,
          drift: Math.hypot(offsetX, offsetY),
        });
      }
    }
  }

  return candidates;
}

export function chooseSmartLabelPlacement(points: Point[], options: SmartLabelPlacementOptions): LabelPlacement {
  const labelSize = estimateEdgeLabelSize(options.labelText);
  const placementCenter = getPlacementCenter(points, options.obstacleRects);
  const stableAxisNudge = getStableLabelNudge(options.edgeId) * 0.55;

  const chooseForProjection = (projection: PolylineProjection) => {
    let bestPlacement: LabelPlacement | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of buildLabelPlacementCandidates(projection, placementCenter, options.laneOffset, stableAxisNudge)) {
      const score = scoreLabelPlacement(candidate.placement, labelSize, options.obstacleRects, candidate.prefersOutwardSide, candidate.drift);

      if (score > bestScore) {
        bestScore = score;
        bestPlacement = candidate.placement;
      }
    }

    return bestPlacement ?? createLabelPlacement(projection.x, projection.y, 0, -28);
  };

  if (typeof options.anchorProgress === "number" && Number.isFinite(options.anchorProgress)) {
    const projection = getPolylinePointAtProgress(points, options.anchorProgress);
    return projection ? chooseForProjection(projection) : createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, 0, -28);
  }

  const segments = buildRouteSegments(points).filter((segment) => segment.length > 24);
  if (segments.length === 0) {
    return createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, 0, -28);
  }

  const totalLength = segments[segments.length - 1]?.cumulativeEnd ?? 1;
  const progressCandidates = buildCandidateAnchorProgresses(points);
  let bestPlacement: LabelPlacement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const progress of progressCandidates) {
    const projection = getPolylinePointAtProgress(points, progress);
    if (!projection) {
      continue;
    }

    const candidate = chooseForProjection(projection);
    const score = scoreLabelPlacement(candidate, labelSize, options.obstacleRects, true, Math.hypot(candidate.bubbleX - candidate.anchorX, candidate.bubbleY - candidate.anchorY))
      + Math.min(projection.segment.length, totalLength) * 0.06;

    if (score > bestScore) {
      bestScore = score;
      bestPlacement = candidate;
    }
  }

  return bestPlacement ?? createLabelPlacement(points[0]?.x ?? 0, points[0]?.y ?? 0, 0, -28);
}

export function resolveAutoLabelPlacementCollision(placement: LabelPlacement, size: LabelSize, obstacleRects: Rect[]) {
  const baseRect = createLabelRect(placement.bubbleX, placement.bubbleY, size);
  const baseClearance = getMinimumRectClearance(baseRect, obstacleRects);

  if (!Number.isFinite(baseClearance) || baseClearance >= 0) {
    return placement;
  }

  const deltaX = placement.bubbleX - placement.anchorX;
  const deltaY = placement.bubbleY - placement.anchorY;
  const length = Math.hypot(deltaX, deltaY) || 1;
  const normal = { x: deltaX / length, y: deltaY / length };
  const tangent = { x: -normal.y, y: normal.x };
  let bestPlacement = placement;
  let bestScore = baseClearance * 30;

  for (const normalOffset of [12, 24, 40, 60, 84, 112]) {
    for (const tangentOffset of [0, -18, 18, -36, 36, -64, 64]) {
      const candidate = createLabelPlacement(
        placement.anchorX,
        placement.anchorY,
        deltaX + normal.x * normalOffset + tangent.x * tangentOffset,
        deltaY + normal.y * normalOffset + tangent.y * tangentOffset,
      );
      const rect = createLabelRect(candidate.bubbleX, candidate.bubbleY, size);
      const clearance = getMinimumRectClearance(rect, obstacleRects);
      const score = clearance * 36 - candidate.connectorLength * 0.25 - Math.hypot(candidate.bubbleX - placement.bubbleX, candidate.bubbleY - placement.bubbleY) * 0.18;

      if (score > bestScore) {
        bestScore = score;
        bestPlacement = candidate;
      }
    }
  }

  return bestPlacement;
}

export function buildCandidateAnchorProgresses(points: Point[]) {
  const routeSegments = buildRouteSegments(points);
  const totalLength = routeSegments[routeSegments.length - 1]?.cumulativeEnd ?? 0;
  const progressValues = new Set<number>();

  for (const segment of routeSegments) {
    const baseRatios =
      segment.length >= 240
        ? [0.28, 0.4, 0.5, 0.6, 0.72]
        : segment.length >= 140
          ? [0.34, 0.5, 0.66]
          : [0.5];

    for (const ratio of baseRatios) {
      if (totalLength <= 0) {
        continue;
      }

      const progress = clamp((segment.cumulativeStart + segment.length * ratio) / totalLength, 0.18, 0.82);
      progressValues.add(Number(progress.toFixed(4)));
    }
  }

  progressValues.add(0.34);
  progressValues.add(0.5);
  progressValues.add(0.66);

  return [...progressValues].sort((left, right) => left - right);
}
