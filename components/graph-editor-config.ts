import type { RelationEdgeData, EdgeMarkerStyle, EdgePathStyle, GraphDocument, AppNode, AppEdge, ShapeNodeKind } from "./graph/sample-graph";
import { defaultViewport } from "./graph/sample-graph";
import { RelationEdge } from "./graph/relation-edge";
import { ShapeNode } from "./graph/shape-node";
import { getObjectRecord, parseGraphDocument } from "./graph-editor-utils";

export const LEGACY_STORAGE_KEY = "icvn-graph-studio-document-v3";
export const WORKSPACE_STORAGE_KEY = "icvn-graph-studio-workspace-v4";
export const HISTORY_LIMIT = 80;
export const DEFAULT_FILE_NAME = "ICVN 在线关系图";
export const EMPTY_FILE_NAME_PREFIX = "未命名关系图";
export const BACKEND_GRAPH_ID = process.env.NEXT_PUBLIC_DEFAULT_GRAPH_ID ?? "default";

export const defaultRelationEdgeData: RelationEdgeData = {
  pathStyle: "smoothstep",
  dashed: false,
  marker: "arrow",
  color: "#64748b",
};

export const nodeTypes = {
  shapeNode: ShapeNode,
};

export const edgeTypes = {
  relationEdge: RelationEdge,
};

export const shapeOptions: Array<{ kind: ShapeNodeKind; label: string }> = [
  { kind: "rectangle", label: "矩形" },
  { kind: "rounded", label: "圆角矩形" },
  { kind: "ellipse", label: "椭圆" },
  { kind: "diamond", label: "菱形" },
];

export const pathStyleOptions: Array<{ label: string; value: EdgePathStyle }> = [
  { label: "圆角线", value: "smoothstep" },
  { label: "直线", value: "straight" },
  { label: "折线", value: "step" },
];

export const markerOptions: Array<{ label: string; value: EdgeMarkerStyle }> = [
  { label: "箭头", value: "arrow" },
  { label: "无箭头", value: "none" },
];

export const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

export const segmentButtonClassName =
  "inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm font-medium transition";

export const toolbarButtonClassName = "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

export const EXPORT_PADDING = 80;
export const EXPORT_MIN_WIDTH = 960;
export const EXPORT_MIN_HEIGHT = 640;
export const EXPORT_IMAGE_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
export const GRAPH_CANVAS_FONT_FAMILY = `"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif`;

export function isHtmlToImageFontEmbedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("trim") && (message.includes("font") || message.includes("undefined"));
}

export type ExportSaveRequest = {
  filename: string;
  description: string;
  mimeType: string;
  extension: string;
};

export type ExportSaveTarget =
  | {
      kind: "picker";
      handle: {
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      };
    }
  | {
      kind: "download";
      filename: string;
    };

export type WindowWithSaveFilePicker = Window &
  typeof globalThis & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      excludeAcceptAllOption?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<ExportSaveTarget extends { kind: "picker"; handle: infer T } ? T : never>;
  };

export type GraphWorkspaceFile = {
  id: string;
  name: string;
  taskId?: string;
  document: GraphDocument;
  createdAt: string;
  updatedAt: string;
};

export type GraphWorkspace = {
  version: 1;
  activeFileId: string;
  files: GraphWorkspaceFile[];
};

export type DocumentImportStatus = "pending" | "uploading" | "processing" | "completed" | "failed";

export type DocumentImportItem = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  progress: number;
  status: DocumentImportStatus;
  message: string;
  file: File;
};

function createGraphFileId() {
  return globalThis.crypto?.randomUUID?.() ?? `graph-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeGraphFileName(name: string | null | undefined, fallback = DEFAULT_FILE_NAME) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function createEmptyGraphDocument(): GraphDocument {
  return {
    nodes: [],
    edges: [],
    viewport: defaultViewport,
  };
}

export function createWorkspaceFile(options?: {
  id?: string;
  name?: string;
  taskId?: string;
  document?: GraphDocument;
  createdAt?: string;
  updatedAt?: string;
}) {
  const now = new Date().toISOString();

  return {
    id: options?.id ?? createGraphFileId(),
    name: normalizeGraphFileName(options?.name),
    taskId: typeof options?.taskId === "string" && options.taskId.trim() ? options.taskId.trim() : undefined,
    document: structuredClone(options?.document ?? createEmptyGraphDocument()),
    createdAt: options?.createdAt ?? now,
    updatedAt: options?.updatedAt ?? now,
  } satisfies GraphWorkspaceFile;
}

export function buildWorkspacePayload(files: GraphWorkspaceFile[], activeFileId: string): GraphWorkspace {
  return {
    version: 1,
    activeFileId,
    files,
  };
}

export function replaceWorkspaceFile(files: GraphWorkspaceFile[], nextFile: GraphWorkspaceFile) {
  return files.some((file) => file.id === nextFile.id)
    ? files.map((file) => (file.id === nextFile.id ? nextFile : file))
    : [...files, nextFile];
}

export function getNextUntitledFileName(files: GraphWorkspaceFile[]) {
  const usedNames = new Set(files.map((file) => file.name));

  if (!usedNames.has(EMPTY_FILE_NAME_PREFIX)) {
    return EMPTY_FILE_NAME_PREFIX;
  }

  let index = 2;
  while (usedNames.has(`${EMPTY_FILE_NAME_PREFIX} ${index}`)) {
    index += 1;
  }

  return `${EMPTY_FILE_NAME_PREFIX} ${index}`;
}

export function createDocumentImportItem(file: File): DocumentImportItem {
  return {
    id: `document-import-${createGraphFileId()}`,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    progress: 0,
    status: "pending",
    message: "等待上传到后端清洗服务。",
    file,
  };
}

export function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let nextSize = size;
  let unitIndex = 0;

  while (nextSize >= 1024 && unitIndex < units.length - 1) {
    nextSize /= 1024;
    unitIndex += 1;
  }

  return `${nextSize >= 100 || unitIndex === 0 ? Math.round(nextSize) : nextSize.toFixed(1)} ${units[unitIndex]}`;
}

export function getDocumentImportStatusMeta(status: DocumentImportStatus) {
  switch (status) {
    case "uploading":
      return {
        label: "上传中",
        badgeClassName: "bg-sky-100 text-sky-700",
        progressClassName: "bg-sky-500",
      };
    case "processing":
      return {
        label: "处理中",
        badgeClassName: "bg-violet-100 text-violet-700",
        progressClassName: "bg-violet-500",
      };
    case "completed":
      return {
        label: "已完成",
        badgeClassName: "bg-emerald-100 text-emerald-700",
        progressClassName: "bg-emerald-500",
      };
    case "failed":
      return {
        label: "失败",
        badgeClassName: "bg-rose-100 text-rose-700",
        progressClassName: "bg-rose-500",
      };
    default:
      return {
        label: "待处理",
        badgeClassName: "bg-slate-100 text-slate-600",
        progressClassName: "bg-slate-400",
      };
  }
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseWorkspaceStorage(text: string): GraphWorkspace | null {
  try {
    const parsed = JSON.parse(text) as {
      activeFileId?: unknown;
      files?: unknown;
    };

    if (!Array.isArray(parsed.files)) {
      return null;
    }

    const files = parsed.files
      .map<GraphWorkspaceFile | null>((item, index) => {
        const record = getObjectRecord(item);
        const documentSource = record.document;

        try {
          const document = parseGraphDocument(JSON.stringify(documentSource));
          return createWorkspaceFile({
            id: typeof record.id === "string" ? record.id : undefined,
            name:
              typeof record.name === "string"
                ? record.name
                : `${EMPTY_FILE_NAME_PREFIX} ${index + 1}`,
            taskId: typeof record.taskId === "string" ? record.taskId : undefined,
            document,
            createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
            updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
          });
        } catch {
          return null;
        }
      })
      .filter((file): file is GraphWorkspaceFile => Boolean(file));

    if (files.length === 0) {
      return null;
    }

    const activeFileId =
      typeof parsed.activeFileId === "string" && files.some((file) => file.id === parsed.activeFileId)
        ? parsed.activeFileId
        : files[0].id;

    return buildWorkspacePayload(files, activeFileId);
  } catch {
    return null;
  }
}

export type GraphEditorNode = AppNode;
export type GraphEditorEdge = AppEdge;
