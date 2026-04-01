import { runRoute } from "@/lib/server/api";
import { applyTaskResult } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  void request;
  return runRoute(async () => {
    const { taskId } = await context.params;
    return applyTaskResult(taskId);
  });
}
