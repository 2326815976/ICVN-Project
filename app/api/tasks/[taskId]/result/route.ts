import type { SaveTaskResultRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { getTaskResult, saveTaskResult } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return getTaskResult(taskId);
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return saveTaskResult(taskId, await readJsonBody<SaveTaskResultRequest>(request));
  });
}
