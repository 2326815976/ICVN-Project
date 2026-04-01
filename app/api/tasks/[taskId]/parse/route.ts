import type { AiParseRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { parseTaskContent } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return parseTaskContent(taskId, await readJsonBody<AiParseRequest>(request));
  }, 202);
}
