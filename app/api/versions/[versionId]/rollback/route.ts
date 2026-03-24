import type { RollbackVersionRequest } from "@/lib/domain/models";
import { readJsonBody, runRoute } from "@/lib/server/api";
import { rollbackVersion } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    versionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { versionId } = await context.params;
    return rollbackVersion(versionId, await readJsonBody<RollbackVersionRequest>(request));
  });
}
