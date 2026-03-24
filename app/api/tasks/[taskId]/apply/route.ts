import type { ApplyTaskRequest } from "@/lib/domain/models";
import { readOptionalJsonBody, runRoute } from "@/lib/server/api";
import { applyTaskResult } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    const body = await readOptionalJsonBody<ApplyTaskRequest>(request, {});
    return applyTaskResult(taskId, body);
  });
}
