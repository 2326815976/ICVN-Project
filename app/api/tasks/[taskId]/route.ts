import type { UpdateTaskRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { deleteTask, getTaskDetail, updateTask } from "@/lib/server/repository";

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

export async function PATCH(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return updateTask(taskId, await readJsonBody<UpdateTaskRequest>(request));
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { taskId } = await context.params;
    return deleteTask(taskId);
  });
}
