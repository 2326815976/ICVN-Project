"use client";

import { type ChangeEvent, type DragEvent as ReactDragEvent, useCallback, useMemo, useRef, useState } from "react";

import { openApiClient } from "@/lib/client/openapi-client";
import { buildTaskResultFromGraphDocument, extractTextFromDocument, isSupportedDocumentFile } from "@/components/graph-editor-utils";

import {
  BACKEND_GRAPH_ID,
  createDocumentImportItem,
  sleep,
  type DocumentImportItem,
  type DocumentImportStatus,
} from "../graph-editor-config";
import type { GraphDocument } from "../graph/sample-graph";

type RunAutoLayoutFn = (
  document: GraphDocument,
  messages: {
    start: string;
    success: string;
    failure: string;
  },
) => Promise<void | GraphDocument>;

type UseDocumentImportFlowOptions = {
  setStatus: (message: string) => void;
  parseGraphDocument: (text: string) => GraphDocument;
  runAutoLayout: RunAutoLayoutFn;
  onTaskChange?: (taskId: string) => void;
  onProcessingCompleted?: (taskId: string) => void;
};

function getTaskProcessStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "排队中";
    case "uploaded":
      return "已上传";
    case "processing":
      return "处理中";
    case "validated":
      return "已校验";
    case "applied":
      return "已应用";
    case "failed":
      return "失败";
    default:
      return status;
  }
}


const DOCUMENT_PROCESSING_PROGRESS_START = 55;
const DOCUMENT_PROCESSING_PROGRESS_TARGET = 99;
const DOCUMENT_PROCESSING_PROGRESS_TARGET_MS = 5.5 * 60 * 1000;

function getSmoothedProcessingProgress(startedAt: number, status: string, currentProgress: number) {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const normalized = Math.min(elapsedMs / DOCUMENT_PROCESSING_PROGRESS_TARGET_MS, 1);
  const eased = 1 - Math.pow(1 - normalized, 1.12);
  const simulatedProgress =
    DOCUMENT_PROCESSING_PROGRESS_START +
    (DOCUMENT_PROCESSING_PROGRESS_TARGET - DOCUMENT_PROCESSING_PROGRESS_START) * eased;
  const statusFloor = status === "validated" || status === "applied" ? DOCUMENT_PROCESSING_PROGRESS_TARGET : 0;

  return Math.min(
    DOCUMENT_PROCESSING_PROGRESS_TARGET,
    Number(Math.max(currentProgress, simulatedProgress, statusFloor).toFixed(1)),
  );
}
export function useDocumentImportFlow({
  setStatus,
  parseGraphDocument,
  runAutoLayout,
  onTaskChange,
  onProcessingCompleted,
}: UseDocumentImportFlowOptions) {
  const [documentImportItems, setDocumentImportItems] = useState<DocumentImportItem[]>([]);
  const [isDocumentProcessing, setIsDocumentProcessing] = useState(false);
  const [isDocumentDragActive, setIsDocumentDragActive] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState("文本任务");
  const [quickTaskContent, setQuickTaskContent] = useState("");
  const [quickTaskSourceType, setQuickTaskSourceType] = useState<"text" | "news" | "social" | "story" | "custom">("text");
  const [isQuickTaskSubmitting, setIsQuickTaskSubmitting] = useState(false);
  const documentImportInputRef = useRef<HTMLInputElement | null>(null);

  const updateDocumentImportItem = useCallback((itemId: string, patch: Partial<DocumentImportItem>) => {
    setDocumentImportItems((previous) =>
      previous.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    );
  }, []);

  const resetDocumentImportForm = useCallback(() => {
    setDocumentImportItems([]);
    setIsDocumentDragActive(false);
    setQuickTaskTitle("文本任务");
    setQuickTaskContent("");
    setQuickTaskSourceType("text");
    if (documentImportInputRef.current) {
      documentImportInputRef.current.value = "";
    }
  }, []);

  const processTaskToCanvas = useCallback(
    async (
      taskId: string,
      onProgress?: (payload: { status: DocumentImportStatus; progress: number; message: string }) => void,
    ) => {
      let latestStatus = "queued";
      let latestSourceType = "document";
      const maxAttempts = 360;
      const startedAt = Date.now();
      let latestProgress = DOCUMENT_PROCESSING_PROGRESS_START;
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      let resultLoaded = false;
      let taskResult: Awaited<ReturnType<typeof openApiClient.getTaskResult>> | null = null;

      const emitProcessingProgress = () => {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        const elapsedRemainderSeconds = elapsedSeconds % 60;
        const elapsedText = `${String(elapsedMinutes).padStart(2, "0")}:${String(elapsedRemainderSeconds).padStart(2, "0")}`;
        latestProgress = getSmoothedProcessingProgress(startedAt, latestStatus, latestProgress);

        onProgress?.({
          status: "processing",
          progress: latestProgress,
          message: `任务状态：${getTaskProcessStatusLabel(latestStatus)}，已等待 ${elapsedText}`,
        });
      };

      emitProcessingProgress();
      progressTimer = setInterval(emitProcessingProgress, 1000);

      try {
        for (let index = 0; index < maxAttempts; index += 1) {
          await sleep(5000);
          const detail = await openApiClient.getTaskDetail(taskId);
          latestStatus = detail.status;
          latestSourceType = detail.sourceType || latestSourceType;
          latestProgress = getSmoothedProcessingProgress(startedAt, latestStatus, latestProgress);
          emitProcessingProgress();

          if (latestStatus === "failed") {
            break;
          }

          if (latestStatus === "validated" || latestStatus === "applied") {
            try {
              taskResult = await openApiClient.getTaskResult(taskId);
              resultLoaded = true;
              break;
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : "";
              if (!message.includes("Task result is not ready")) {
                throw error;
              }
            }
          }
        }
      } finally {
        if (progressTimer) {
          clearInterval(progressTimer);
        }
      }

      if (latestStatus === "failed") {
        throw new Error("后端任务处理失败，请检查任务详情。");
      }

      if (!resultLoaded || !taskResult) {
        throw new Error("任务仍在处理中，请稍后从任务列表继续加载结果。");
      }

      if (taskResult.result?.nodes && taskResult.result?.edges) {
        const importedDocument = parseGraphDocument(
          JSON.stringify({
            data: taskResult.result,
          }),
        );
        const finalDocument =
          (await runAutoLayout(importedDocument, {
            start: "后端结果已返回，正在自动整理布局...",
            success: "已将后端任务结果导入画布。",
            failure: "任务结果已导入，但自动布局失败，已保留原始坐标。",
          })) ?? importedDocument;

        const persistedResult = buildTaskResultFromGraphDocument(finalDocument, {
          graphId: BACKEND_GRAPH_ID,
          sourceType: latestSourceType,
        });

        await openApiClient.saveTaskResult(taskId, { result: persistedResult });
      }

      return openApiClient.applyTaskResult(taskId);
    },
    [parseGraphDocument, runAutoLayout],
  );

  const appendDocumentFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      const incomingFiles = fileList ? Array.from(fileList) : [];
      if (incomingFiles.length === 0) {
        return;
      }

      const existingSignatures = new Set(
        documentImportItems.map((item) => `${item.name}-${item.size}-${item.lastModified}`),
      );
      const supportedFiles = incomingFiles.filter(isSupportedDocumentFile);
      const unsupportedFiles = incomingFiles.filter((file) => !isSupportedDocumentFile(file));
      const nextItems = supportedFiles
        .filter((file) => {
          const signature = `${file.name}-${file.size}-${file.lastModified}`;
          if (existingSignatures.has(signature)) {
            return false;
          }

          existingSignatures.add(signature);
          return true;
        })
        .map(createDocumentImportItem);

      if (nextItems.length === 0) {
        if (supportedFiles.length === 0 && unsupportedFiles.length > 0) {
          setStatus("当前仅支持 .doc、.docx、.txt 文件。");
          return;
        }

        setStatus("所选文档已在处理列表中，请勿重复上传。");
        return;
      }

      setDocumentImportItems((previous) => [...previous, ...nextItems]);
      if (unsupportedFiles.length > 0) {
        setStatus(`已加入 ${nextItems.length} 份文档，已忽略 ${unsupportedFiles.length} 份不支持的文件（仅支持 .doc、.docx、.txt）。`);
        return;
      }

      setStatus(`已加入 ${nextItems.length} 份文档，等待处理。`);
    },
    [documentImportItems, setStatus],
  );

  const handleTriggerDocumentUpload = useCallback(() => {
    documentImportInputRef.current?.click();
  }, []);

  const handleDocumentFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      appendDocumentFiles(event.target.files);
      event.target.value = "";
    },
    [appendDocumentFiles],
  );

  const handleDocumentDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDocumentDragActive(true);
  }, []);

  const handleDocumentDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDocumentDragActive(false);
  }, []);

  const handleDocumentDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDocumentDragActive(false);
      appendDocumentFiles(event.dataTransfer.files);
    },
    [appendDocumentFiles],
  );

  const handleRemoveDocumentImportItem = useCallback((itemId: string) => {
    setDocumentImportItems((previous) => previous.filter((item) => item.id !== itemId));
  }, []);

  const handleClearCompletedDocumentImports = useCallback(() => {
    const completedCount = documentImportItems.filter((item) => item.status === "completed").length;
    if (completedCount === 0) {
      return;
    }

    setDocumentImportItems((previous) => previous.filter((item) => item.status !== "completed"));
    setStatus(`已清理 ${completedCount} 份已完成文档。`);
  }, [documentImportItems, setStatus]);

  const handleStartDocumentProcessing = useCallback(async () => {
    const queue = documentImportItems.filter((item) => item.status === "pending" || item.status === "failed");
    if (queue.length === 0) {
      setStatus("请先选择需要处理的文档。当前列表中没有待处理项。");
      return;
    }

    setIsDocumentProcessing(true);
    setStatus(`已开始处理 ${queue.length} 份文档，正在调用后端任务接口。`);

    try {
      for (const item of queue) {
        updateDocumentImportItem(item.id, {
          status: "uploading",
          progress: 12,
          message: "正在提取文档文本...",
        });
      }

      try {
        const extractedContents: string[] = [];

        for (const item of queue) {
          updateDocumentImportItem(item.id, {
            status: "uploading",
            progress: 20,
            message: "正在提取文档文本...",
          });

          const parsedText = await extractTextFromDocument(item.file);
          if (!parsedText) {
            throw new Error(`${item.name} 未提取到可解析文本，请检查文件内容后重试。`);
          }

          extractedContents.push(parsedText);
          try {
          updateDocumentImportItem(item.id, {
            status: "processing",
            progress: 35,
            message: "文本提取完成，等待整批提交...",
          });
          } catch {
            // no-op, next loop handles batch submission
          }
        }

        const task = await openApiClient.createDocumentTask({
          sourceType: "document",
          title: queue.length === 1 ? queue[0].name : `${queue[0].name} 等 ${queue.length} 份文档`,
          files: queue.map((item) => ({
            fileName: item.name,
            mimeType: item.type || "application/octet-stream",
            size: item.size,
          })),
        });
        onTaskChange?.(task.id);

        for (const item of queue) {
          updateDocumentImportItem(item.id, {
            status: "processing",
            progress: 45,
            message: `任务已创建（${task.id}），正在整批提交解析文本...`,
          });
        }

        await openApiClient.parseTaskContent(task.id, { content: extractedContents });
        const processed = await processTaskToCanvas(task.id, (payload) => {
          for (const item of queue) {
            updateDocumentImportItem(item.id, {
              status: payload.status,
              progress: payload.progress,
              message: payload.message,
            });
          }
        });

        for (const item of queue) {
          updateDocumentImportItem(item.id, {
            status: "completed",
            progress: 100,
            message: processed.status === "applied" ? "处理完成，后端已自动应用任务结果。" : "处理完成。",
          });
        }

        onTaskChange?.(task.id);
        setStatus("文档处理队列已完成，已整批提交到任务接口。");
        resetDocumentImportForm();
        onProcessingCompleted?.(task.id);
      } catch (error: unknown) {
        for (const item of queue) {
          updateDocumentImportItem(item.id, {
            status: "failed",
            progress: 0,
            message: error instanceof Error ? error.message : "处理失败，请稍后重试。",
          });
        }
        throw error;
      }
    } finally {
      setIsDocumentProcessing(false);
    }
  }, [documentImportItems, onProcessingCompleted, onTaskChange, processTaskToCanvas, resetDocumentImportForm, setStatus, updateDocumentImportItem]);

  const handleSubmitQuickTextTask = useCallback(async () => {
    const content = quickTaskContent.trim();
    const title = quickTaskTitle.trim() || "文本任务";
    if (!content) {
      setStatus("请先输入要提交的文本内容。");
      return;
    }

    setIsQuickTaskSubmitting(true);
    setStatus("正在提交文本任务到后端...");
    try {
      const task = await openApiClient.createDocumentTask({
        sourceType: quickTaskSourceType,
        title,
        content: content.slice(0, 60000),
      });
      onTaskChange?.(task.id);
      await openApiClient.parseTaskContent(task.id, { content: [content.slice(0, 60000)] });

      setStatus(`任务已创建（${task.id}），正在处理并导入画布...`);
      const processed = await processTaskToCanvas(task.id);
      setQuickTaskContent("");
      setStatus(processed.status === "applied" ? "文本任务处理完成，已入图。" : "文本任务处理完成。");
      onTaskChange?.(task.id);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "文本任务提交失败，请稍后重试。");
    } finally {
      setIsQuickTaskSubmitting(false);
    }
  }, [onTaskChange, processTaskToCanvas, quickTaskContent, quickTaskSourceType, quickTaskTitle, setStatus]);

  const documentImportSummary = useMemo(() => {
    const summary = {
      total: documentImportItems.length,
      pending: 0,
      uploading: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const item of documentImportItems) {
      summary[item.status] += 1;
    }

    return summary;
  }, [documentImportItems]);

  const documentImportOverallProgress = useMemo(
    () =>
      documentImportItems.length > 0
        ? Math.round(documentImportItems.reduce((total, item) => total + item.progress, 0) / documentImportItems.length)
        : 0,
    [documentImportItems],
  );

  const canStartDocumentProcessing = documentImportItems.some(
    (item) => item.status === "pending" || item.status === "failed",
  );
  const hasCompletedDocumentImports = documentImportItems.some((item) => item.status === "completed");

  return {
    documentImportInputRef,
    documentImportItems,
    isDocumentProcessing,
    isDocumentDragActive,
    setIsDocumentDragActive,
    quickTaskTitle,
    setQuickTaskTitle,
    quickTaskContent,
    setQuickTaskContent,
    quickTaskSourceType,
    setQuickTaskSourceType,
    isQuickTaskSubmitting,
    documentImportSummary,
    documentImportOverallProgress,
    canStartDocumentProcessing,
    hasCompletedDocumentImports,
    handleTriggerDocumentUpload,
    handleDocumentFileInputChange,
    handleDocumentDragOver,
    handleDocumentDragLeave,
    handleDocumentDrop,
    handleRemoveDocumentImportItem,
    handleClearCompletedDocumentImports,
    handleStartDocumentProcessing,
    handleSubmitQuickTextTask,
  };
}
