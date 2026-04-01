import type { CreateNodeRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { createGraphNode } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => createGraphNode(await readJsonBody<CreateNodeRequest>(request)), 201);
}
