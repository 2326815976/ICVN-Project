import { assertNonEmptyString, parseInteger, runRoute } from "@/lib/server/api";
import { queryPath } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const strategy = searchParams.get("strategy") === "all" ? "all" : "shortest";

  return runRoute(async () =>
    queryPath({
      graphId: assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      sourceId: assertNonEmptyString(searchParams.get("sourceId"), "BAD_REQUEST", "sourceId is required"),
      targetId: assertNonEmptyString(searchParams.get("targetId"), "BAD_REQUEST", "targetId is required"),
      maxDepth: parseInteger(searchParams.get("maxDepth"), 4, { min: 1, max: 10 }),
      strategy,
    }),
  );
}
