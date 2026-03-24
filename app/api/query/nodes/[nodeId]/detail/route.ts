import { assertNonEmptyString, runRoute } from "@/lib/server/api";
import { queryNodeDetail } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    nodeId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () => {
    const { nodeId } = await context.params;
    return queryNodeDetail(
      assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      nodeId,
    );
  });
}
