import type { UpdateEdgeRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { deleteGraphEdge, updateGraphEdge } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { id } = await context.params;
    return updateGraphEdge(id, await readJsonBody<UpdateEdgeRequest>(request));
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () => {
    const { id } = await context.params;
    return deleteGraphEdge(id, searchParams.get("graphId"));
  });
}
