import type { GraphEdge, GraphNode, SubgraphQueryRequest, SubgraphResponse } from "@/lib/domain/models";

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
