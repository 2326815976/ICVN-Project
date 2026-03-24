import type { CreateVersionRequest } from "@/lib/domain/models";
import { assertNonEmptyString, parseInteger, readJsonBody, runRoute } from "@/lib/server/api";
import { createVersion, listVersions } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => createVersion(await readJsonBody<CreateVersionRequest>(request)), 201);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  return runRoute(async () =>
    listVersions(
      assertNonEmptyString(searchParams.get("graphId"), "BAD_REQUEST", "graphId is required"),
      parseInteger(searchParams.get("page"), 1, { min: 1 }),
      parseInteger(searchParams.get("pageSize"), 20, { min: 1, max: 100 }),
    ),
  );
}
