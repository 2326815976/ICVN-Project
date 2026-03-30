import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";

export class DocumentExtractError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const execFileAsync = promisify(execFile);

export type ExtractDocumentRequest = {
  fileName: string;
  contentBase64: string;
};

export function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractLegacyWordTextWithTextutil(params: ExtractDocumentRequest) {
  const fileName = params.fileName.trim();
  const lowerFileName = fileName.toLowerCase();

  if (!lowerFileName.endsWith(".doc")) {
    throw new DocumentExtractError(400, "BAD_REQUEST", "Only .doc extraction is supported by this route");
  }

  if (!params.contentBase64.trim()) {
    throw new DocumentExtractError(400, "BAD_REQUEST", "contentBase64 is required");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "icvn-doc-"));
  const tempInputPath = path.join(tempDir, path.basename(fileName));

  try {
    await writeFile(tempInputPath, Buffer.from(params.contentBase64, "base64"));
    const { stdout } = await execFileAsync("/usr/bin/textutil", [
      "-convert",
      "txt",
      "-stdout",
      tempInputPath,
    ]);

    const extracted = normalizeExtractedText(stdout);
    if (!extracted) {
      throw new DocumentExtractError(422, "DOCUMENT_EXTRACT_EMPTY", "未能从该 .doc 文件中提取到有效文本");
    }

    return {
      text: extracted,
    };
  } catch (error) {
    if (error instanceof DocumentExtractError) {
      throw error;
    }

    throw new DocumentExtractError(500, "DOCUMENT_EXTRACT_FAILED", "无法提取 .doc 文本，请稍后重试", {
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
