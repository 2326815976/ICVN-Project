"use client";

import { type ChangeEvent, type DragEvent as ReactDragEvent, useCallback, useMemo, useRef, useState } from "react";

import { openApiClient } from "@/lib/client/openapi-client";

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
) => Promise<void>;

type UseDocumentImportFlowOptions = {
  setStatus: (message: string) => void;
  parseGraphDocument: (text: string) => GraphDocument;
  runAutoLayout: RunAutoLayoutFn;
};

export function useDocumentImportFlow({ setStatus, parseGraphDocument, runAutoLayout }: UseDocumentImportFlowOptions) {
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
      for (let index = 0; index < 6; index += 1) {
        await sleep(900);
        const detail = await openApiClient.getTaskDetail(taskId);
        latestStatus = detail.status;
        onProgress?.({
          status: "processing",
          progress: Math.min(90, 55 + index * 6),
          message: `任务状态：${latestStatus}`,
        });
        if (latestStatus === "validated" || latestStatus === "applied" || latestStatus === "failed") {
          break;
        }
      }

      if (latestStatus === "failed") {
        throw new Error("后端任务处理失败，请检查任务详情。");
      }

      const result = await openApiClient.getTaskResult(taskId);
      if (result.result?.nodes && result.result?.edges) {
        const importedDocument = parseGraphDocument(
          JSON.stringify({
            data: result.result,
          }),
        );
        await runAutoLayout(importedDocument, {
          start: "后端结果已返回，正在自动整理布局...",
          success: "已将后端任务结果导入画布。",
          failure: "任务结果已导入，但自动布局失败，已保留原始坐标。",
        });
      }

      return openApiClient.applyTaskResult(taskId, {
        graphId: BACKEND_GRAPH_ID,
        createSnapshot: true,
      });
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
      const nextItems = incomingFiles
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
        setStatus("所选文档已在处理列表中，请勿重复上传。");
        return;
      }

      setDocumentImportItems((previous) => [...previous, ...nextItems]);
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
          message: "正在创建后端任务...",
        });

        try {
          let content = "";
          try {
            const canReadAsText =
              item.type.startsWith("text/") ||
              item.type.includes("json") ||
              item.name.endsWith(".md") ||
              item.name.endsWith(".txt");
            if (canReadAsText) {
              content = await item.file.text();
            }
          } catch {
            content = "";
          }

          const task = await openApiClient.createDocumentTask({
            graphId: BACKEND_GRAPH_ID,
            sourceType: "document",
            title: item.name,
            content: content.slice(0, 60000),
            files: [
              {
                fileName: item.name,
                mimeType: item.type || "application/octet-stream",
                size: item.size,
              },
            ],
            options: {
              createSnapshot: true,
            },
          });

          updateDocumentImportItem(item.id, {
            status: "processing",
            progress: 45,
            message: `任务已创建（${task.id}），正在等待后端解析...`,
          });
          const applied = await processTaskToCanvas(task.id, (payload) => {
            updateDocumentImportItem(item.id, {
              status: payload.status,
              progress: payload.progress,
              message: payload.message,
            });
          });

          updateDocumentImportItem(item.id, {
            status: "completed",
            progress: 100,
            message: applied.version
              ? `处理完成，已入图并生成版本 #${applied.version.versionNo}`
              : "处理完成，后端已应用任务结果。",
          });
        } catch (error: unknown) {
          updateDocumentImportItem(item.id, {
            status: "failed",
            progress: 0,
            message: error instanceof Error ? error.message : "处理失败，请稍后重试。",
          });
        }
      }

      setStatus("文档处理队列已完成，已对接任务接口。");
    } finally {
      setIsDocumentProcessing(false);
    }
  }, [documentImportItems, processTaskToCanvas, setStatus, updateDocumentImportItem]);

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
        graphId: BACKEND_GRAPH_ID,
        sourceType: quickTaskSourceType,
        title,
        content: content.slice(0, 60000),
        options: {
          createSnapshot: true,
        },
      });

      setStatus(`任务已创建（${task.id}），正在处理并导入画布...`);
      const applied = await processTaskToCanvas(task.id);
      setQuickTaskContent("");
      setStatus(
        applied.version
          ? `文本任务处理完成，已入图并生成版本 #${applied.version.versionNo}。`
          : "文本任务处理完成，已入图。",
      );
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "文本任务提交失败，请稍后重试。");
    } finally {
      setIsQuickTaskSubmitting(false);
    }
  }, [processTaskToCanvas, quickTaskContent, quickTaskSourceType, quickTaskTitle, setStatus]);

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
