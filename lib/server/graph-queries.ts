import type { GraphEdge, GraphNode, PathItem, SubgraphQueryRequest, SubgraphResponse } from "@/lib/domain/models";

type GraphData = {
  graphId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function buildNodeMap(nodes: GraphNode[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}

function buildAdjacency(edges: GraphEdge[]) {
  const adjacency = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const sourceItems = adjacency.get(edge.sourceId) ?? [];
    sourceItems.push(edge);
    adjacency.set(edge.sourceId, sourceItems);

    const targetItems = adjacency.get(edge.targetId) ?? [];
    targetItems.push(edge);
    adjacency.set(edge.targetId, targetItems);
  }

  return adjacency;
}

function getNeighborId(edge: GraphEdge, currentId: string) {
  return edge.sourceId === currentId ? edge.targetId : edge.sourceId;
}

export function createSubgraph(data: GraphData, options: SubgraphQueryRequest): SubgraphResponse {
  const nodeMap = buildNodeMap(data.nodes);
  const adjacency = buildAdjacency(data.edges);
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const queue = options.rootIds.map((rootId) => ({ nodeId: rootId, depth: 0 }));
  const visited = new Set<string>(options.rootIds);

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    const node = nodeMap.get(current.nodeId);
    if (!node) {
      continue;
    }

    if (options.nodeTypes?.length && !options.nodeTypes.includes(node.type)) {
      continue;
    }

    nodeIds.add(node.id);

    if (current.depth >= options.depth) {
      continue;
    }

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (options.relationFilters?.length && !options.relationFilters.includes(edge.relation)) {
        continue;
      }

      const neighborId = getNeighborId(edge, current.nodeId);
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) {
        continue;
      }

      if (options.nodeTypes?.length && !options.nodeTypes.includes(neighbor.type)) {
        continue;
      }

      nodeIds.add(neighbor.id);
      edgeIds.add(edge.id);

      if (!visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        queue.push({ nodeId: neighbor.id, depth: current.depth + 1 });
      }
    }
  }

  return {
    graphId: data.graphId,
    nodes: data.nodes.filter((node) => nodeIds.has(node.id)),
    edges: data.edges.filter((edge) => edgeIds.has(edge.id)),
  };
}

export function createShortestPath(data: GraphData, sourceId: string, targetId: string, maxDepth: number) {
  const nodeMap = buildNodeMap(data.nodes);
  const adjacency = buildAdjacency(data.edges);
  const queue: Array<{ nodeId: string; nodes: string[]; edges: string[] }> = [
    { nodeId: sourceId, nodes: [sourceId], edges: [] },
  ];
  const visited = new Set<string>([sourceId]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    if (current.nodeId === targetId) {
      return materializePath(data, current.nodes, current.edges, nodeMap);
    }

    if (current.edges.length >= maxDepth) {
      continue;
    }

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const neighborId = getNeighborId(edge, current.nodeId);

      if (visited.has(neighborId)) {
        continue;
      }

      visited.add(neighborId);
      queue.push({
        nodeId: neighborId,
        nodes: [...current.nodes, neighborId],
        edges: [...current.edges, edge.id],
      });
    }
  }

  return null;
}

export function createAllPaths(data: GraphData, sourceId: string, targetId: string, maxDepth: number) {
  const nodeMap = buildNodeMap(data.nodes);
  const adjacency = buildAdjacency(data.edges);
  const results: PathItem[] = [];

  function dfs(currentId: string, nodePath: string[], edgePath: string[]) {
    if (edgePath.length > maxDepth || results.length >= 10) {
      return;
    }

    if (currentId === targetId) {
      const path = materializePath(data, nodePath, edgePath, nodeMap);
      if (path) {
        results.push(path);
      }
      return;
    }

    for (const edge of adjacency.get(currentId) ?? []) {
      const neighborId = getNeighborId(edge, currentId);

      if (nodePath.includes(neighborId)) {
        continue;
      }

      dfs(neighborId, [...nodePath, neighborId], [...edgePath, edge.id]);
    }
  }

  dfs(sourceId, [sourceId], []);
  return results;
}

function materializePath(
  data: GraphData,
  nodeIds: string[],
  edgeIds: string[],
  nodeMap: Map<string, GraphNode>,
) {
  const edgeMap = new Map(data.edges.map((edge) => [edge.id, edge]));
  const nodes = nodeIds
    .map((nodeId) => nodeMap.get(nodeId))
    .filter((node): node is GraphNode => Boolean(node));
  const edges = edgeIds
    .map((edgeId) => edgeMap.get(edgeId))
    .filter((edge): edge is GraphEdge => Boolean(edge));

  if (nodes.length !== nodeIds.length || edges.length !== edgeIds.length) {
    return null;
  }

  return {
    nodes,
    edges,
    length: edges.length,
  } satisfies PathItem;
}
