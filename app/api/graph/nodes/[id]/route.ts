import type { UpdateNodeRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { deleteGraphNode, updateGraphNode } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { id } = await context.params;
    return updateGraphNode(id, await readJsonBody<UpdateNodeRequest>(request));
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () => {
    const { id } = await context.params;
    return deleteGraphNode(id, searchParams.get("graphId"));
  });
}
