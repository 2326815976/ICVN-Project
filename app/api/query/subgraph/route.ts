import type { SubgraphQueryRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { querySubgraph } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => querySubgraph(await readJsonBody<SubgraphQueryRequest>(request)));
}
