import { assertNonEmptyString, parseInteger, runRoute } from "@/lib/server/api";
import { getGraphSubgraph } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () =>
    getGraphSubgraph(
      assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      assertNonEmptyString(searchParams.get("rootId"), "BAD_REQUEST", "rootId is required"),
      parseInteger(searchParams.get("depth"), 2, { min: 1 }),
    ),
  );
}
