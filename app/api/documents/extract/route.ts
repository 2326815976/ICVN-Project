import { ApiError, readJsonBody, runRoute } from "@/lib/server/api";
import {
  DocumentExtractError,
  extractLegacyWordTextWithTextutil,
  type ExtractDocumentRequest,
} from "@/lib/server/document-extract";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return runRoute(async () => {
    try {
      return await extractLegacyWordTextWithTextutil(await readJsonBody<ExtractDocumentRequest>(request));
    } catch (error) {
      if (error instanceof DocumentExtractError) {
        throw new ApiError(error.status, error.code, error.message, error.details);
      }

      throw error;
    }
  });
}
