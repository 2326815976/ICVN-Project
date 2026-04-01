import { assertNonEmptyString, parseInteger, runRoute } from "@/lib/server/api";
import { searchNodes } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () =>
    searchNodes({
      graphId: assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      keyword: assertNonEmptyString(searchParams.get("keyword"), "BAD_REQUEST", "keyword is required"),
      nodeType: searchParams.get("nodeType"),
      sourceType: searchParams.get("sourceType"),
      page: parseInteger(searchParams.get("page"), 1, { min: 1 }),
      pageSize: parseInteger(searchParams.get("pageSize"), 20, { min: 1, max: 100 }),
    }),
  );
}
