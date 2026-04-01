"use client";

import { type ChangeEvent, type DragEvent as ReactDragEvent, useCallback, useMemo, useRef, useState } from "react";

import { openApiClient } from "@/lib/client/openapi-client";
import { assertGraphDocumentCanBeImported, extractTextFromDocument, isSupportedDocumentFile } from "@/components/graph-editor-utils";

import {
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
) => Promise<GraphDocument>;

const TASK_CANVAS_IMPORT_TIMEOUT_MS = 15000;
const TASK_APPLY_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type UseDocumentImportFlowOptions = {
  setStatus: (message: string) => void;
  parseGraphDocument: (text: string) => GraphDocument;
  runAutoLayout: RunAutoLayoutFn;
  onTaskChange?: (taskId: string) => void;
  onProcessingCompleted?: (taskId: string) => void;
};

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

  const processTaskToCanvas = useCallback(
    async (
      taskId: string,
      onProgress?: (payload: { status: DocumentImportStatus; progress: number; message: string }) => void,
    ) => {
      let latestStatus = "queued";
      const maxAttempts = 360;
      let resultLoaded = false;
      let taskResult: Awaited<ReturnType<typeof openApiClient.getTaskResult>> | null = null;

      for (let index = 0; index < maxAttempts; index += 1) {
        await sleep(5000);
        const detail = await openApiClient.getTaskDetail(taskId);
        latestStatus = detail.status;
        const elapsedMinutes = Math.floor(((index + 1) * 5) / 60);
        onProgress?.({
          status: "processing",
          progress: Math.min(95, 55 + Math.floor(((index + 1) / maxAttempts) * 40)),
          message:
            elapsedMinutes > 0
              ? `任务状态：${latestStatus}，已等待约 ${elapsedMinutes} 分钟`
              : `任务状态：${latestStatus}`,
        });

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

      if (latestStatus === "failed") {
        throw new Error("后端任务处理失败，请检查任务详情。");
      }

      if (!resultLoaded || !taskResult) {
        throw new Error("任务仍在处理中，请稍后从任务列表继续加载结果。");
      }

      if (Array.isArray(taskResult.result?.nodes) && Array.isArray(taskResult.result?.edges)) {
        onProgress?.({
          status: "processing",
          progress: 88,
          message: "\u540e\u7aef\u7ed3\u679c\u5df2\u8fd4\u56de\uff0c\u6b63\u5728\u5bfc\u5165\u753b\u5e03...",
        });

        const importedDocument = parseGraphDocument(
          JSON.stringify({
            data: taskResult.result,
          }),
        );
        assertGraphDocumentCanBeImported(importedDocument, "\u540e\u7aef\u8fd4\u56de\u7684\u5173\u7cfb\u56fe\u7ed3\u679c");

        try {
          await withTimeout(
            runAutoLayout(importedDocument, {
              start: "\u540e\u7aef\u7ed3\u679c\u5df2\u8fd4\u56de\uff0c\u6b63\u5728\u81ea\u52a8\u6574\u7406\u5e03\u5c40...",
              success: "\u5df2\u5c06\u540e\u7aef\u4efb\u52a1\u7ed3\u679c\u5bfc\u5165\u753b\u5e03\u3002",
              failure: "\u4efb\u52a1\u7ed3\u679c\u5df2\u5bfc\u5165\uff0c\u4f46\u81ea\u52a8\u5e03\u5c40\u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u539f\u59cb\u5750\u6807\u3002",
            }),
            TASK_CANVAS_IMPORT_TIMEOUT_MS,
            "\u753b\u5e03\u5bfc\u5165\u8d85\u65f6\uff0c\u5df2\u8df3\u8fc7\u672c\u6b21\u524d\u7aef\u81ea\u52a8\u5bfc\u5165\uff0c\u53ef\u7a0d\u540e\u4ece\u4efb\u52a1\u5217\u8868\u91cd\u65b0\u6253\u5f00\u3002",
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("\u8d85\u65f6")) {
            throw error;
          }

          onProgress?.({
            status: "processing",
            progress: 94,
            message,
          });
        }
      }

      onProgress?.({
        status: "processing",
        progress: 96,
        message: "\u6b63\u5728\u540c\u6b65\u4efb\u52a1\u7ed3\u679c\u5230\u6570\u636e\u5e93...",
      });

      const applyPromise = openApiClient.applyTaskResult(taskId);

      try {
        const applied = await withTimeout(
          applyPromise,
          TASK_APPLY_TIMEOUT_MS,
          "\u4efb\u52a1\u7ed3\u679c\u5df2\u4fdd\u5b58\uff0c\u5165\u56fe\u540c\u6b65\u4ecd\u5728\u540e\u53f0\u7ee7\u7eed\uff0c\u53ef\u7a0d\u540e\u4ece\u4efb\u52a1\u5217\u8868\u67e5\u770b\u3002",
        );

        onProgress?.({
          status: "processing",
          progress: 98,
          message: "\u4efb\u52a1\u7ed3\u679c\u5df2\u540c\u6b65\u5230\u6570\u636e\u5e93\uff0c\u6b63\u5728\u5b8c\u6210\u6536\u5c3e...",
        });

        return applied;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("\u540e\u53f0\u7ee7\u7eed")) {
          throw error;
        }

        void applyPromise.catch((applyError: unknown) => {
          setStatus(applyError instanceof Error ? applyError.message : "\u4efb\u52a1\u5165\u56fe\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002");
        });

        onProgress?.({
          status: "processing",
          progress: 98,
          message,
        });

        return { taskId, status: "validated" as const };
      }
    },
    [parseGraphDocument, runAutoLayout, setStatus],
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
            message:
              processed.status === "applied"
                ? "\u5904\u7406\u5b8c\u6210\uff0c\u540e\u7aef\u5df2\u81ea\u52a8\u5e94\u7528\u4efb\u52a1\u7ed3\u679c\u3002"
                : "\u5904\u7406\u5b8c\u6210\uff0c\u753b\u5e03\u5df2\u5bfc\u5165\uff0c\u5165\u56fe\u540c\u6b65\u6b63\u5728\u540e\u53f0\u7ee7\u7eed\u3002",
          });
        }

        setIsDocumentDragActive(false);
        onTaskChange?.(task.id);
        onProcessingCompleted?.(task.id);
        setStatus(
          processed.status === "applied"
            ? "\u6587\u6863\u5904\u7406\u5b8c\u6210\uff0c\u5df2\u5bfc\u5165\u753b\u5e03\u5e76\u540c\u6b65\u5230\u6570\u636e\u5e93\u3002"
            : "\u6587\u6863\u5904\u7406\u5b8c\u6210\uff0c\u5df2\u5bfc\u5165\u753b\u5e03\uff1b\u5165\u56fe\u540c\u6b65\u6b63\u5728\u540e\u53f0\u7ee7\u7eed\uff0c\u53ef\u7a0d\u540e\u5728\u4efb\u52a1\u5217\u8868\u67e5\u770b\u3002",
        );
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
  }, [documentImportItems, onProcessingCompleted, onTaskChange, processTaskToCanvas, setStatus, updateDocumentImportItem]);

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
