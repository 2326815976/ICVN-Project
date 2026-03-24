import type { AiParseRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { createAiParseJob } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => createAiParseJob(await readJsonBody<AiParseRequest>(request)), 202);
}
