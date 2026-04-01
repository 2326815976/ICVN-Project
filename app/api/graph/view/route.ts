import { assertNonEmptyString, runRoute } from "@/lib/server/api";
import { getGraphView } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () =>
    getGraphView(assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required")),
  );
}
