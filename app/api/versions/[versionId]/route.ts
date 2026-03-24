import { runRoute } from "@/lib/server/api";
import { getVersionDetail } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    versionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { versionId } = await context.params;
    return getVersionDetail(versionId);
  });
}
