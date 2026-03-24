import type { CreateTaskRequest } from "@/lib/domain/models";
import { assertNonEmptyString, parseInteger, readJsonBody, runRoute } from "@/lib/server/api";
import { createTask, listTasks } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => createTask(await readJsonBody<CreateTaskRequest>(request)), 201);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () =>
    listTasks({
      graphId: assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      status: searchParams.get("status"),
      sourceType: searchParams.get("sourceType"),
      page: parseInteger(searchParams.get("page"), 1, { min: 1 }),
      pageSize: parseInteger(searchParams.get("pageSize"), 20, { min: 1, max: 100 }),
    }),
  );
}
