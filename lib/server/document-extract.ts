import { execFile } from "child_process";
import * as mammoth from "mammoth";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
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
const EXTRACT_STDOUT_MAX_BUFFER = 32 * 1024 * 1024;

export type ExtractDocumentRequest = {
  fileName: string;
  contentBase64: string;
};

export function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000\u0007]/g, " ")
    .replace(/[\u0001-\u0006\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocTextViaTextutil(tempInputPath: string) {
  const { stdout } = await execFileAsync(
    "/usr/bin/textutil",
    ["-convert", "txt", "-stdout", tempInputPath],
    {
      maxBuffer: EXTRACT_STDOUT_MAX_BUFFER,
      windowsHide: true,
    },
  );

  return stdout;
}

async function extractDocTextViaWordCom(tempDir: string, tempInputPath: string) {
  const tempOutputPath = path.join(tempDir, "output.docx");
  const script = [
    "& {",
    "  param([string]$documentPath, [string]$outputPath)",
    "  $ErrorActionPreference = 'Stop'",
    "  $word = $null",
    "  $document = $null",
    "  try {",
    "    $word = New-Object -ComObject Word.Application",
    "    $word.Visible = $false",
    "    $word.DisplayAlerts = 0",
    "    $document = $word.Documents.Open($documentPath)",
    "    $document.SaveAs([ref]$outputPath, [ref]16) | Out-Null",
    "  }",
    "  finally {",
    "    if ($document -ne $null) {",
    "      $document.Close([ref]$false) | Out-Null",
    "      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)",
    "    }",
    "",
    "    if ($word -ne $null) {",
    "      $word.Quit() | Out-Null",
    "      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)",
    "    }",
    "",
    "    [GC]::Collect()",
    "    [GC]::WaitForPendingFinalizers()",
    "  }",
    "}",
  ].join("\n");

  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      tempInputPath,
      tempOutputPath,
    ],
    {
      maxBuffer: EXTRACT_STDOUT_MAX_BUFFER,
      windowsHide: true,
    },
  );

  const outputBuffer = await readFile(tempOutputPath);
  const result = await mammoth.extractRawText({ buffer: outputBuffer });
  return result.value;
}

async function extractDocTextByPlatform(tempDir: string, tempInputPath: string) {
  if (process.platform === "win32") {
    return extractDocTextViaWordCom(tempDir, tempInputPath);
  }

  return extractDocTextViaTextutil(tempInputPath);
}

export async function extractLegacyWordTextWithTextutil(params: ExtractDocumentRequest) {
  const fileName = params.fileName.trim();
  const lowerFileName = fileName.toLowerCase();
  const isDoc = lowerFileName.endsWith(".doc");
  const isDocx = lowerFileName.endsWith(".docx");

  if (!isDoc && !isDocx) {
    throw new DocumentExtractError(400, "BAD_REQUEST", "仅支持 .doc 或 .docx 文件解析");
  }

  if (!params.contentBase64.trim()) {
    throw new DocumentExtractError(400, "BAD_REQUEST", "contentBase64 is required");
  }

  const fileBuffer = Buffer.from(params.contentBase64, "base64");

  if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      const extracted = normalizeExtractedText(result.value);
      if (!extracted) {
        throw new DocumentExtractError(422, "DOCUMENT_EXTRACT_EMPTY", "未能从该 .docx 文件中提取到有效文本");
      }

      return {
        text: extracted,
      };
    } catch (error) {
      if (error instanceof DocumentExtractError) {
        throw error;
      }

      throw new DocumentExtractError(500, "DOCUMENT_EXTRACT_FAILED", "无法提取 .docx 文本，请稍后重试", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "icvn-doc-"));
  const tempInputPath = path.join(tempDir, isDocx ? "input.docx" : "input.doc");

  try {
    await writeFile(tempInputPath, fileBuffer);
    const rawText = await extractDocTextByPlatform(tempDir, tempInputPath);
    const extracted = normalizeExtractedText(rawText);

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
      platform: process.platform,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}


