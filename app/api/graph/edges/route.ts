import type { CreateEdgeRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { createGraphEdge } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => createGraphEdge(await readJsonBody<CreateEdgeRequest>(request)), 201);
}
