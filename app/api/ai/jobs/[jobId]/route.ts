import { runRoute } from "@/lib/server/api";
import { getAiJob } from "@/lib/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  return runRoute(async () => {
    const { jobId } = await context.params;
    return getAiJob(jobId);
  });
}
