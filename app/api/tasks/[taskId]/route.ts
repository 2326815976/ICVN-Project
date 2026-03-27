import { runRoute } from "@/lib/server/api";
import { deleteTask, getTaskDetail } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return getTaskDetail(taskId);
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return deleteTask(taskId);
  });
}
