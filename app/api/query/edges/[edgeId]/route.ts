import { assertNonEmptyString, runRoute } from "@/lib/server/api";
import { queryEdgeDetail } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    edgeId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () => {
    const { edgeId } = await context.params;
    return queryEdgeDetail(
      assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      edgeId,
    );
  });
}
