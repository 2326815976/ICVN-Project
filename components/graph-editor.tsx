"use client";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  addEdge,
  getViewportForBounds,
  type Connection,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  FileJson,
  FileText,
  Files,
  Image as ImageIcon,
  Pencil,
  Redo2,
  RefreshCcw,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { openApiClient } from "@/lib/client/openapi-client";
import type { Task } from "@/lib/domain/models";
import { cn } from "@/lib/utils";

import {
  DEFAULT_FILE_NAME,
  EXPORT_IMAGE_PLACEHOLDER,
  EXPORT_MIN_HEIGHT,
  EXPORT_MIN_WIDTH,
  EXPORT_PADDING,
  GRAPH_CANVAS_FONT_FAMILY,
  HISTORY_LIMIT,
  LEGACY_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  BACKEND_GRAPH_ID,
  buildWorkspacePayload,
  createEmptyGraphDocument,
  createWorkspaceFile,
  defaultRelationEdgeData,
  edgeTypes,
  formatFileSize,
  getDocumentImportStatusMeta,
  getNextUntitledFileName,
  inputClassName,
  isHtmlToImageFontEmbedError,
  markerOptions,
  nodeTypes,
  normalizeGraphFileName,
  parseWorkspaceStorage,
  pathStyleOptions,
  replaceWorkspaceFile,
  segmentButtonClassName,
  shapeOptions,
  sortRecordsByCreatedAtDesc,
  toolbarButtonClassName,
  type ExportSaveRequest,
  type ExportSaveTarget,
  type GraphWorkspaceFile,
  type WindowWithSaveFilePicker,
} from "./graph-editor-config";
import {
  Field,
  NewFileMenuButton,
  SectionCard,
  ShapePreview,
  TaskList,
  WorkspaceFileList,
  formatWorkspaceTime,
} from "./graph-editor-panels";
import { layoutGraphDocument } from "./graph/auto-layout";
import {
  createRelationEdge,
  createSampleGraphDocument,
  createShapeNode,
  defaultViewport,
  stringifyGraphDocument,
  type AppEdge,
  type AppNode,
  type GraphDocument,
  type RelationEdgeData,
  type ShapeNodeData,
  type ShapeNodeKind,
} from "./graph/sample-graph";
import {
  assertGraphDocumentCanBeImported,
  buildTaskResultFromGraphDocument,
  clamp,
  isEditableTarget,
  isShapeNode,
  parseGraphDocument,
  readFileAsDataUrl,
  sanitizeEdgeForDocument,
  sanitizeNodeForDocument,
  shouldIgnoreCanvasGestureTarget,
  syncSelectedFlags,
} from "./graph-editor-utils";
import { useDocumentImportFlow } from "./hooks/use-document-import-flow";

const EXPORT_GRID_GAP = 24;
const EXPORT_GRID_BACKGROUND = "#f8fafc";
const EXPORT_GRID_COLOR = "rgba(148, 163, 184, 0.2)";

function createExportBackgroundCanvas(options: {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  mode: "grid" | "plain";
  viewport: Viewport;
}) {
  const backgroundCanvas = document.createElement("canvas");
  backgroundCanvas.width = options.pixelWidth;
  backgroundCanvas.height = options.pixelHeight;

  const context = backgroundCanvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建导出背景画布。");
  }

  if (options.mode === "plain") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, options.pixelWidth, options.pixelHeight);
    return backgroundCanvas;
  }

  context.fillStyle = EXPORT_GRID_BACKGROUND;
  context.fillRect(0, 0, options.pixelWidth, options.pixelHeight);

  const scaleX = options.pixelWidth / options.width;
  const scaleY = options.pixelHeight / options.height;
  const gridSpacingX = Math.max(EXPORT_GRID_GAP * options.viewport.zoom * scaleX, 8);
  const gridSpacingY = Math.max(EXPORT_GRID_GAP * options.viewport.zoom * scaleY, 8);
  const offsetX = ((options.viewport.x * scaleX) % gridSpacingX + gridSpacingX) % gridSpacingX;
  const offsetY = ((options.viewport.y * scaleY) % gridSpacingY + gridSpacingY) % gridSpacingY;

  context.beginPath();
  context.strokeStyle = EXPORT_GRID_COLOR;
  context.lineWidth = 1;

  for (let x = offsetX; x <= options.pixelWidth; x += gridSpacingX) {
    context.moveTo(Math.round(x) + 0.5, 0);
    context.lineTo(Math.round(x) + 0.5, options.pixelHeight);
  }

  for (let y = offsetY; y <= options.pixelHeight; y += gridSpacingY) {
    context.moveTo(0, Math.round(y) + 0.5);
    context.lineTo(options.pixelWidth, Math.round(y) + 0.5);
  }

  context.stroke();
  return backgroundCanvas;
}

const CANVAS_LOAD_TIMEOUT_MS = 10000;

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

function hasStoredNodePositions(document: GraphDocument) {
  return (
    document.nodes.length > 0 &&
    document.nodes.every(
      (node) => Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y),
    )
  );
}

function isEmptyGraphDocument(document: GraphDocument) {
  return document.nodes.length === 0 && document.edges.length === 0;
}

function isReusableDefaultWorkspaceFile(file: GraphWorkspaceFile) {
  return !file.taskId && file.name === DEFAULT_FILE_NAME && isEmptyGraphDocument(file.document);
}

function getStatusTone(message: string) {
  if (/(\u5931\u8d25|\u9519\u8bef|\u65e0\u6548|\u4e0d\u53ef\u7528|\u91cd\u8bd5|\u672a\u80fd|\u5f02\u5e38|\u8d85\u65f6)/u.test(message)) {
    return "error" as const;
  }

  if (/(\u6210\u529f|\u5df2\u4fdd\u5b58|\u5df2\u5199\u5165|\u5df2\u5220\u9664|\u5df2\u521b\u5efa|\u5df2\u66f4\u65b0|\u5df2\u52a0\u8f7d|\u5df2\u5bfc\u5165|\u5df2\u5207\u6362|\u5df2\u5904\u7406|\u5df2\u6e05\u7406|\u5df2\u81ea\u52a8)/u.test(message)) {
    return "success" as const;
  }

  return "info" as const;
}

export function GraphEditor() {
  const initialDocument = useMemo(() => createEmptyGraphDocument(), []);
  const initialFile = useMemo(
    () => createWorkspaceFile({ name: DEFAULT_FILE_NAME, document: initialDocument }),
    [initialDocument],
  );
  const [nodes, setNodes, applyNodesChange] = useNodesState<AppNode>(initialDocument.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(initialDocument.edges);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<AppNode, AppEdge> | null>(null);
  const [viewport, setViewport] = useState<Viewport>(initialDocument.viewport);
  const [importText, setImportText] = useState(() => stringifyGraphDocument(initialDocument));
  const [status, setStatus] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<GraphWorkspaceFile[]>([initialFile]);
  const [activeFileId, setActiveFileId] = useState(initialFile.id);
  const [currentFileName, setCurrentFileName] = useState(initialFile.name);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedEdgeLabelId, setSelectedEdgeLabelId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState(true);
  const [isTaskListCollapsed, setIsTaskListCollapsed] = useState(false);
  const [isRightShapeLibraryCollapsed, setIsRightShapeLibraryCollapsed] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isImportingLayout, setIsImportingLayout] = useState(false);
  const [isDocumentImportDialogOpen, setIsDocumentImportDialogOpen] = useState(false);
  const [canvasBackgroundMode, setCanvasBackgroundMode] = useState<"grid" | "plain">("plain");
  const [isBackgroundMenuOpen, setIsBackgroundMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const backgroundMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const suppressNextEmptySelectionRef = useRef(false);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const historyRef = useRef<GraphDocument[]>([structuredClone(initialDocument)]);
  const futureRef = useRef<GraphDocument[]>([]);
  const suppressHistoryRef = useRef(false);
  const suspendGestureHistoryRef = useRef(false);
  const historyGestureDepthRef = useRef(0);
  const historyFlushFrameRef = useRef<number | null>(null);
  const lastSnapshotRef = useRef(stringifyGraphDocument(initialDocument));
  const lastHistorySceneRef = useRef(
    JSON.stringify({
      nodes: initialDocument.nodes,
      edges: initialDocument.edges,
    }),
  );
  const copiedNodeRef = useRef<Array<Extract<AppNode, { type: "shapeNode" }>>>([]);
  const workspaceFilesRef = useRef<GraphWorkspaceFile[]>([initialFile]);
  const activeFileIdRef = useRef(initialFile.id);
  const currentFileNameRef = useRef(initialFile.name);
  const pendingViewportFitRef = useRef<{ duration?: number; padding?: number; syncImportText?: boolean } | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const pendingTaskTitleSyncRef = useRef(new Map<string, string>());
  const initialTaskAutoLoadRetryRef = useRef<string | null>(null);
  const blockedAutoLoadTaskIdsRef = useRef(new Set<string>());
  const skipNextTitleBlurCommitRef = useRef<string | null>(null);
  const hasInitializedFromDatabaseRef = useRef(false);
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const [selectedWorkspaceFileId, setSelectedWorkspaceFileId] = useState(initialFile.id);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState(initialFile.name);
  const [selectedWorkspaceFilePreviewDraft, setSelectedWorkspaceFilePreviewDraft] = useState(() => stringifyGraphDocument(initialFile.document));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [isTaskListLoading, setIsTaskListLoading] = useState(false);
  const [taskListError, setTaskListError] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [isSavingToDatabase, setIsSavingToDatabase] = useState(false);
  const loadingTaskIdRef = useRef<string | null>(null);
  const statusDismissTimeoutRef = useRef<number | null>(null);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedEdgeLabelOwner = edges.find((edge) => edge.id === selectedEdgeLabelId) ?? null;
  const inspectedEdge = selectedEdge ?? selectedEdgeLabelOwner ?? null;
  const activeWorkspaceFile = workspaceFiles.find((file) => file.id === activeFileId) ?? null;
  const selectedWorkspaceFile = workspaceFiles.find((file) => file.id === selectedWorkspaceFileId) ?? null;
  const loadingTask = loadingTaskId ? tasks.find((task) => task.id === loadingTaskId) ?? null : null;
  const selectedWorkspaceFilePreview = useMemo(
    () => (selectedWorkspaceFile ? stringifyGraphDocument(selectedWorkspaceFile.document) : ""),
    [selectedWorkspaceFile],
  );
  const isSelectedWorkspaceFilePreviewDirty = selectedWorkspaceFilePreviewDraft !== selectedWorkspaceFilePreview;
  useEffect(() => {
    setSelectedWorkspaceFilePreviewDraft(selectedWorkspaceFilePreview);
  }, [selectedWorkspaceFilePreview]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    loadingTaskIdRef.current = loadingTaskId;
  }, [loadingTaskId]);
  useEffect(() => {
    if (typeof window === "undefined" || !status) {
      return;
    }

    if (statusDismissTimeoutRef.current !== null) {
      window.clearTimeout(statusDismissTimeoutRef.current);
    }

    statusDismissTimeoutRef.current = window.setTimeout(() => {
      setStatus("");
      statusDismissTimeoutRef.current = null;
    }, 3200);

    return () => {
      if (statusDismissTimeoutRef.current !== null) {
        window.clearTimeout(statusDismissTimeoutRef.current);
      }
    };
  }, [status]);
  const selectedShapeNodes = selectedNodeIds
    .map((nodeId) => nodes.find((node) => node.id === nodeId) ?? null)
    .filter(isShapeNode);
  const selectedNodeCount = selectedNodeIds.length;
  const selectedEdgeCount = selectedEdgeIds.length;
  const totalSelectionCount = selectedNodeCount + selectedEdgeCount;
  const isMultiSelection = totalSelectionCount > 1;
  const isCanvasEmpty = nodes.length === 0 && edges.length === 0;
  const shapeNodeCount = nodes.filter((node) => node.type === "shapeNode").length;
  const selectedEdgeData: RelationEdgeData = {
    pathStyle: inspectedEdge?.data?.pathStyle ?? defaultRelationEdgeData.pathStyle,
    dashed: inspectedEdge?.data?.dashed ?? defaultRelationEdgeData.dashed,
    marker: inspectedEdge?.data?.marker ?? defaultRelationEdgeData.marker,
    color: inspectedEdge?.data?.color ?? defaultRelationEdgeData.color,
    labelOffset: inspectedEdge?.data?.labelOffset,
    labelAnchorPosition: inspectedEdge?.data?.labelAnchorPosition,
    manualRoute: inspectedEdge?.data?.manualRoute,
    manualRouteMode: inspectedEdge?.data?.manualRouteMode,
    isEventEdge: inspectedEdge?.data?.isEventEdge,
    eventID: inspectedEdge?.data?.eventID,
    eventOverview: inspectedEdge?.data?.eventOverview,
    eventDescription: inspectedEdge?.data?.eventDescription,
    eventName1: inspectedEdge?.data?.eventName1,
    eventName2: inspectedEdge?.data?.eventName2,
  };
  const selectedEdgeLabelText = typeof selectedEdgeLabelOwner?.label === "string" ? selectedEdgeLabelOwner.label : "";
  const selectedShapeNode = isShapeNode(selectedNode) ? selectedNode : null;
  const selectedEdgeLabel = typeof selectedEdge?.label === "string" ? selectedEdge.label : "";
  const selectedEventInspectorEdge =
    selectedEdge?.data?.isEventEdge === true
      ? selectedEdge
      : selectedEdgeLabelOwner?.data?.isEventEdge === true
        ? selectedEdgeLabelOwner
        : null;

  const getNodeEventDisplayName = useCallback(
    (nodeId: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== "shapeNode") {
        return "";
      }

      const firstLine = node.data.text
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);

      return firstLine ?? "";
    },
    [nodes],
  );

  useEffect(() => {
    workspaceFilesRef.current = workspaceFiles;
  }, [workspaceFiles]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    currentFileNameRef.current = currentFileName;
  }, [currentFileName]);

  const writeWorkspaceToStorage = useCallback(
    (files: GraphWorkspaceFile[], nextActiveFileId: string, options?: { announce?: string }) => {
      if (typeof window === "undefined") {
        return false;
      }

      try {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(buildWorkspacePayload(files, nextActiveFileId)));

        if (options?.announce) {
          setStatus(options.announce);
        }

        return true;
      } catch {
        if (options?.announce) {
          setStatus("浏览器存储不可用，本次未能写入本地缓存。");
        }

        return false;
      }
    },
    [],
  );

  const updateWorkspaceState = useCallback(
    (files: GraphWorkspaceFile[], nextActiveFileId: string) => {
      workspaceFilesRef.current = files;
      activeFileIdRef.current = nextActiveFileId;
      setWorkspaceFiles(files);
      setActiveFileId(nextActiveFileId);

      const nextActiveFile = files.find((file) => file.id === nextActiveFileId) ?? files[0] ?? null;
      if (nextActiveFile) {
        currentFileNameRef.current = nextActiveFile.name;
        setCurrentFileName(nextActiveFile.name);
      }

      setSelectedWorkspaceFileId(nextActiveFileId);
    },
    [],
  );

  const buildCurrentFileRecord = useCallback(
    (document: GraphDocument, options?: { name?: string; baseFile?: GraphWorkspaceFile | null }) => {
      const now = new Date().toISOString();
      const baseFile = options?.baseFile ?? workspaceFilesRef.current.find((file) => file.id === activeFileIdRef.current) ?? null;

      return createWorkspaceFile({
        id: baseFile?.id ?? activeFileIdRef.current,
        name: options?.name ?? currentFileNameRef.current,
        taskId: baseFile?.taskId,
        document,
        createdAt: baseFile?.createdAt ?? now,
        updatedAt: now,
      });
    },
    [],
  );

  const bindTaskToWorkspaceFile = useCallback(
    (fileId: string, taskId: string, options?: { title?: string; switchToFile?: boolean }) => {
      const currentFiles = workspaceFilesRef.current;
      const targetFile = currentFiles.find((file) => file.id === fileId);
      if (!targetFile) {
        return null;
      }

      const normalizedName = options?.title
        ? normalizeGraphFileName(options.title, targetFile.name)
        : targetFile.name;

      const nextFile = createWorkspaceFile({
        ...targetFile,
        name: normalizedName,
        taskId,
      });
      const nextFiles = replaceWorkspaceFile(currentFiles, nextFile);
      const nextActiveFileId = options?.switchToFile ? nextFile.id : activeFileIdRef.current;

      updateWorkspaceState(nextFiles, nextActiveFileId);
      writeWorkspaceToStorage(nextFiles, nextActiveFileId);

      if (selectedWorkspaceFileId === nextFile.id || nextActiveFileId === nextFile.id) {
        setRenameDraft(normalizedName);
      }

      return nextFile;
    },
    [selectedWorkspaceFileId, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const syncCurrentFileSnapshot = useCallback(
    (document: GraphDocument, options?: { name?: string }) => {
      const nextFile = buildCurrentFileRecord(document, { name: options?.name });
      const nextFiles = replaceWorkspaceFile(workspaceFilesRef.current, nextFile);
      updateWorkspaceState(nextFiles, nextFile.id);
      return {
        nextFile,
        nextFiles,
      };
    },
    [buildCurrentFileRecord, updateWorkspaceState],
  );

  const persistToLocalStorage = useCallback(
    (document: GraphDocument, options?: { announce?: string; syncImportText?: boolean; targetFileId?: string }) => {
      try {
        const targetFileId = typeof options?.targetFileId === "string" ? options.targetFileId.trim() : "";
        const targetFile =
          (targetFileId ? workspaceFilesRef.current.find((file) => file.id === targetFileId) : null) ??
          workspaceFilesRef.current.find((file) => file.id === activeFileIdRef.current) ??
          null;
        const nextActiveFileId = activeFileIdRef.current;
        const normalizedName = normalizeGraphFileName(targetFile?.name ?? currentFileNameRef.current);
        const nextFile = buildCurrentFileRecord(document, {
          name: normalizedName,
          baseFile: targetFile,
        });
        const nextFiles = replaceWorkspaceFile(workspaceFilesRef.current, nextFile);
        updateWorkspaceState(nextFiles, nextActiveFileId);
        const didPersist = writeWorkspaceToStorage(nextFiles, nextActiveFileId, options);

        if (options?.syncImportText && nextFile.id === nextActiveFileId) {
          setImportText(stringifyGraphDocument(document));
        }

        return didPersist;
      } catch {
        if (options?.announce) {
          setStatus("浏览器存储不可用，本次未能写入本地缓存。");
        }

        return false;
      }
    },
    [buildCurrentFileRecord, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const syncSelectionState = useCallback(
    ({
      edgeIds = [],
      edgeLabelId = null,
      nodeIds = [],
      primaryEdgeId,
      primaryNodeId,
    }: {
      edgeIds?: string[];
      edgeLabelId?: string | null;
      nodeIds?: string[];
      primaryEdgeId?: string | null;
      primaryNodeId?: string | null;
    }) => {
      const nodeIdSet = new Set(nodeIds);
      const edgeIdSet = new Set(edgeIds);

      setSelectedNodeIds(nodeIds);
      setSelectedEdgeIds(edgeIds);
      setSelectedNodeId(primaryNodeId ?? nodeIds[0] ?? null);
      setSelectedEdgeId(primaryEdgeId ?? edgeIds[0] ?? null);
      setSelectedEdgeLabelId(edgeLabelId);
      setNodes((currentNodes) => syncSelectedFlags(currentNodes, nodeIdSet));
      setEdges((currentEdges) => syncSelectedFlags(currentEdges, edgeIdSet));
      if (typeof window !== "undefined" && !edgeLabelId) {
        window.dispatchEvent(new CustomEvent("icvn:clear-edge-label-selection"));
      }
    },
    [setEdges, setNodes],
  );

  useEffect(() => {
    if (selectedEdgeLabelId && !selectedEdgeLabelOwner) {
      setSelectedEdgeLabelId(null);
    }
  }, [selectedEdgeLabelId, selectedEdgeLabelOwner]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleExternalEdgeSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ edgeId?: string }>).detail;
      if (!detail?.edgeId) {
        return;
      }

      if (!edges.some((edge) => edge.id === detail.edgeId)) {
        return;
      }

      suppressNextEmptySelectionRef.current = true;
      syncSelectionState({
        nodeIds: [],
        edgeIds: [detail.edgeId],
        primaryNodeId: null,
        primaryEdgeId: detail.edgeId,
      });
    };

    const handleExternalEdgeLabelSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ edgeId?: string }>).detail;
      if (!detail?.edgeId || !edges.some((edge) => edge.id === detail.edgeId)) {
        return;
      }

      syncSelectionState({
        nodeIds: [],
        edgeIds: [],
        edgeLabelId: detail.edgeId,
        primaryNodeId: null,
        primaryEdgeId: null,
      });
      setStatus("已选中说明标签，Delete 将仅删除说明文字。");
    };

    window.addEventListener("icvn:select-edge", handleExternalEdgeSelection as EventListener);
    window.addEventListener("icvn:select-edge-label", handleExternalEdgeLabelSelection as EventListener);
    return () =>
      {
        window.removeEventListener("icvn:select-edge", handleExternalEdgeSelection as EventListener);
        window.removeEventListener("icvn:select-edge-label", handleExternalEdgeLabelSelection as EventListener);
      };
  }, [edges, setStatus, syncSelectionState]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  const loadTaskList = useCallback(
    async (options?: { highlightTaskId?: string; silent?: boolean; preserveCurrentSelection?: boolean }) => {
      setIsTaskListLoading(true);
      if (!options?.silent) {
        setTaskListError(null);
      }

      try {
        const response = await openApiClient.listTasks({
          page: 1,
          pageSize: 20,
        });
        const nextTasks = sortRecordsByCreatedAtDesc(response.items);

        setTasks(nextTasks);
        setTaskListError(null);
        setSelectedTaskId((current) => {
          if (options?.highlightTaskId && nextTasks.some((task) => task.id === options.highlightTaskId)) {
            return options.highlightTaskId;
          }

          if (options?.preserveCurrentSelection !== false && current && nextTasks.some((task) => task.id === current)) {
            return current;
          }

          return nextTasks[0]?.id ?? null;
        });
        return nextTasks;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "暂时无法获取任务列表。";
        setTaskListError(message);
        if (!options?.silent) {
          setStatus(message);
        }
      return [];
      } finally {
        setIsTaskListLoading(false);
      }
    },
    [],
  );


  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setIsSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    const resetSpacePressed = () => setIsSpacePressed(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetSpacePressed);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", resetSpacePressed);
    };
  }, []);

  const updateHistoryState = useCallback(() => {
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const serializeDocument = useCallback(
    (): GraphDocument => ({
      nodes: nodes.map(sanitizeNodeForDocument),
      edges: edges.map(sanitizeEdgeForDocument),
      viewport,
    }),
    [edges, nodes, viewport],
  );

  const pruneRedundantDefaultWorkspaceFiles = useCallback(() => {
    const currentFiles = workspaceFilesRef.current;

    if (!currentFiles.some((file) => file.taskId)) {
      return false;
    }

    const nextFiles = currentFiles.filter((file) => !isReusableDefaultWorkspaceFile(file));
    if (nextFiles.length === currentFiles.length || nextFiles.length === 0) {
      return false;
    }

    const nextActiveFileId = nextFiles.some((file) => file.id === activeFileIdRef.current)
      ? activeFileIdRef.current
      : nextFiles[0].id;
    const nextActiveFile = nextFiles.find((file) => file.id === nextActiveFileId) ?? nextFiles[0];

    updateWorkspaceState(nextFiles, nextActiveFileId);
    setRenameDraft(nextActiveFile.name);
    setRenamingFileId(null);
    writeWorkspaceToStorage(nextFiles, nextActiveFileId);
    return true;
  }, [updateWorkspaceState, writeWorkspaceToStorage]);

  const reconcileWorkspaceFilesWithTasks = useCallback(
    (taskItems: Task[]) => {
      if (taskItems.length === 0) {
        return false;
      }

      const taskIds = new Set(taskItems.map((task) => task.id));
      let nextFiles = workspaceFilesRef.current.filter((file) => !file.taskId || taskIds.has(file.taskId));
      let didChange = nextFiles.length !== workspaceFilesRef.current.length;

      for (const task of taskItems) {
        const normalizedTitle = normalizeGraphFileName(task.title);
        const matchedFile =
          nextFiles.find((file) => file.taskId === task.id) ??
          nextFiles.find((file) => !file.taskId && file.name === task.title) ??
          nextFiles.find((file) => isReusableDefaultWorkspaceFile(file)) ??
          null;

        if (matchedFile) {
          const needsBinding = matchedFile.taskId !== task.id;
          const needsRename = matchedFile.name !== normalizedTitle;

          if (!needsBinding && !needsRename) {
            continue;
          }

          const reboundFile = createWorkspaceFile({
            ...matchedFile,
            name: normalizedTitle,
            taskId: task.id,
          });
          nextFiles = replaceWorkspaceFile(nextFiles, reboundFile);
          didChange = true;
          continue;
        }

        nextFiles = [
          ...nextFiles,
          createWorkspaceFile({
            name: task.title,
            taskId: task.id,
            document: createEmptyGraphDocument(),
          }),
        ];
        didChange = true;
      }

      if (!didChange || nextFiles.length === 0) {
        return false;
      }

      const nextActiveFile =
        nextFiles.find((file) => file.id === activeFileIdRef.current) ??
        nextFiles.find((file) => file.taskId === selectedTaskId) ??
        nextFiles[0] ??
        null;

      if (!nextActiveFile) {
        return false;
      }

      updateWorkspaceState(nextFiles, nextActiveFile.id);
      setRenameDraft(nextActiveFile.name);
      setRenamingFileId(null);
      writeWorkspaceToStorage(nextFiles, nextActiveFile.id);
      return true;
    },
    [selectedTaskId, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const ensureWorkspaceFileForTask = useCallback(
    (task: Task, options?: { switchToFile?: boolean }) => {
      const existingWorkspaceFile =
        workspaceFilesRef.current.find((file) => file.taskId === task.id) ??
        workspaceFilesRef.current.find((file) => !file.taskId && file.name === task.title);

      if (existingWorkspaceFile) {
        return (
          bindTaskToWorkspaceFile(existingWorkspaceFile.id, task.id, {
            title: task.title,
            switchToFile: options?.switchToFile,
          }) ?? existingWorkspaceFile
        );
      }

      const reusableWorkspaceFile = workspaceFilesRef.current.find(isReusableDefaultWorkspaceFile) ?? null;
      if (reusableWorkspaceFile) {
        return (
          bindTaskToWorkspaceFile(reusableWorkspaceFile.id, task.id, {
            title: task.title,
            switchToFile: options?.switchToFile,
          }) ?? reusableWorkspaceFile
        );
      }

      const { nextFiles: currentFiles } = syncCurrentFileSnapshot(serializeDocument(), {
        name: normalizeGraphFileName(currentFileNameRef.current),
      });
      const nextFile = createWorkspaceFile({
        name: task.title,
        taskId: task.id,
        document: createEmptyGraphDocument(),
      });
      const nextFiles = [...currentFiles, nextFile];
      const nextActiveFileId = options?.switchToFile ? nextFile.id : activeFileIdRef.current;

      updateWorkspaceState(nextFiles, nextActiveFileId);
      writeWorkspaceToStorage(nextFiles, nextActiveFileId);

      if (selectedWorkspaceFileId === nextFile.id || nextActiveFileId === nextFile.id) {
        setRenameDraft(nextFile.name);
      }

      return nextFile;
    },
    [
      bindTaskToWorkspaceFile,
      selectedWorkspaceFileId,
      serializeDocument,
      syncCurrentFileSnapshot,
      updateWorkspaceState,
      writeWorkspaceToStorage,
    ],
  );
  const ensureWorkspaceFileForTaskRef = useRef(ensureWorkspaceFileForTask);
  useEffect(() => {
    ensureWorkspaceFileForTaskRef.current = ensureWorkspaceFileForTask;
  }, [ensureWorkspaceFileForTask]);

  useEffect(() => {
    if (tasks.length === 0) {
      return;
    }

    pruneRedundantDefaultWorkspaceFiles();
    reconcileWorkspaceFilesWithTasks(tasks);
  }, [pruneRedundantDefaultWorkspaceFiles, reconcileWorkspaceFilesWithTasks, tasks]);

  const serializeScene = useCallback(
    () =>
      JSON.stringify({
        nodes: nodes.map(sanitizeNodeForDocument),
        edges: edges.map(sanitizeEdgeForDocument),
      }),
    [edges, nodes],
  );

  const commitHistorySnapshot = useCallback(() => {
    const currentDocument = serializeDocument();
    const current = stringifyGraphDocument(currentDocument);
    const currentScene = serializeScene();

    if (current === lastSnapshotRef.current) {
      return false;
    }

    if (currentScene === lastHistorySceneRef.current) {
      lastSnapshotRef.current = current;
      return false;
    }

    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      lastSnapshotRef.current = current;
      lastHistorySceneRef.current = currentScene;
      return false;
    }

    historyRef.current.push(structuredClone(currentDocument));
    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current.shift();
    }
    futureRef.current = [];
    lastSnapshotRef.current = current;
    lastHistorySceneRef.current = currentScene;
    updateHistoryState();
    return true;
  }, [serializeDocument, serializeScene, updateHistoryState]);

  const beginHistoryGesture = useCallback(() => {
    if (historyFlushFrameRef.current && typeof window !== "undefined") {
      window.cancelAnimationFrame(historyFlushFrameRef.current);
      historyFlushFrameRef.current = null;
    }

    historyGestureDepthRef.current += 1;
    suspendGestureHistoryRef.current = true;
  }, []);

  const endHistoryGesture = useCallback(() => {
    if (historyGestureDepthRef.current <= 0 && !suspendGestureHistoryRef.current) {
      return;
    }

    if (historyGestureDepthRef.current > 0) {
      historyGestureDepthRef.current -= 1;
    }

    if (historyGestureDepthRef.current > 0) {
      return;
    }

    suspendGestureHistoryRef.current = false;

    if (typeof window === "undefined") {
      void commitHistorySnapshot();
      return;
    }

    if (historyFlushFrameRef.current) {
      window.cancelAnimationFrame(historyFlushFrameRef.current);
    }

    historyFlushFrameRef.current = window.requestAnimationFrame(() => {
      historyFlushFrameRef.current = null;
      void commitHistorySnapshot();
    });
  }, [commitHistorySnapshot]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const shouldBeginGesture = changes.some(
        (change) =>
          (change.type === "position" && change.dragging === true) ||
          (change.type === "dimensions" && change.resizing === true),
      );
      const shouldEndGesture = changes.some(
        (change) =>
          (change.type === "position" && change.dragging === false) ||
          (change.type === "dimensions" && change.resizing === false),
      );

      if (shouldBeginGesture && !suspendGestureHistoryRef.current) {
        beginHistoryGesture();
      }

      applyNodesChange(changes);

      if (shouldEndGesture && suspendGestureHistoryRef.current) {
        if (typeof window === "undefined") {
          endHistoryGesture();
          return;
        }

        window.requestAnimationFrame(() => {
          endHistoryGesture();
        });
      }
    },
    [applyNodesChange, beginHistoryGesture, endHistoryGesture],
  );

  const clearSelection = useCallback(() => {
    syncSelectionState({
      nodeIds: [],
      edgeIds: [],
      primaryNodeId: null,
      primaryEdgeId: null,
    });
  }, [syncSelectionState]);

  const applyViewport = useCallback(
    (nextViewport: Viewport, options?: { duration?: number }) => {
      setViewport(nextViewport);

      if (flowInstance) {
        void flowInstance.setViewport(nextViewport, options);
      }
    },
    [flowInstance],
  );

  const fitViewportToScene = useCallback(
    async (options?: { duration?: number; padding?: number }) => {
      if (!flowInstance) {
        return null;
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      await flowInstance.fitView({
        padding: options?.padding ?? 0.18,
        duration: options?.duration ?? 260,
      });
      const nextViewport = flowInstance.getViewport();
      setViewport(nextViewport);
      return nextViewport;
    },
    [flowInstance],
  );

  const applyDocument = useCallback(
    (
      document: GraphDocument,
      nextStatus: string,
      options?: {
        resetHistory?: boolean;
        suppressHistory?: boolean;
      },
    ) => {
      if (options?.resetHistory) {
        historyRef.current = [structuredClone(document)];
        futureRef.current = [];
        lastSnapshotRef.current = stringifyGraphDocument(document);
        lastHistorySceneRef.current = JSON.stringify({
          nodes: document.nodes,
          edges: document.edges,
        });
        updateHistoryState();
      }

      if (options?.suppressHistory) {
        suppressHistoryRef.current = true;
      }

      setNodes(document.nodes);
      setEdges(document.edges);
      applyViewport(document.viewport, { duration: 220 });
      setImportText(stringifyGraphDocument(document));
      clearSelection();
      setStatus(nextStatus);
    },
    [applyViewport, clearSelection, setEdges, setNodes, updateHistoryState],
  );

  const restoreWorkspaceFromLocalCache = useCallback((options?: { applyCanvas?: boolean }) => {
    if (typeof window === "undefined") {
      return false;
    }

    let cached = "";

    try {
      cached = window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? "";
    } catch {
      setStatus("浏览器存储不可用，已保留当前画布。");
      return false;
    }

    if (!cached) {
      return false;
    }

    const workspace = parseWorkspaceStorage(cached);

    if (workspace) {
      const initialFile = workspace.files[0];
      updateWorkspaceState(workspace.files, initialFile.id);
      setRenameDraft(initialFile.name);
      setRenamingFileId(null);

      if (options?.applyCanvas === false) {
        return true;
      }

      applyDocument(initialFile.document, "已恢复第一个本地画布。", { resetHistory: true });
      return true;
    }

    try {
      const document = parseGraphDocument(cached);
      const migratedFile = createWorkspaceFile({ name: DEFAULT_FILE_NAME, document });
      updateWorkspaceState([migratedFile], migratedFile.id);
      setRenameDraft(migratedFile.name);
      setRenamingFileId(null);
      writeWorkspaceToStorage([migratedFile], migratedFile.id);

      if (options?.applyCanvas === false) {
        return true;
      }

      applyDocument(document, "已恢复上次保存的本地画布。", { resetHistory: true });
      return true;
    } catch {
      setStatus("检测到本地缓存，但解析失败，已保留当前空白画布。");
      return false;
    }
  }, [applyDocument, updateWorkspaceState, writeWorkspaceToStorage]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasCompletedInitialLoad) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    const snapshot = serializeDocument();
    const targetFileId = activeFileIdRef.current;
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      persistToLocalStorage(snapshot, { targetFileId });
    }, 900);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [hasCompletedInitialLoad, persistToLocalStorage, serializeDocument]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasCompletedInitialLoad) {
      return;
    }

    const handleBeforeUnload = () => {
      persistToLocalStorage(serializeDocument(), {
        targetFileId: activeFileIdRef.current,
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasCompletedInitialLoad, persistToLocalStorage, serializeDocument]);

  useEffect(() => {
    if (!flowInstance || !pendingViewportFitRef.current) {
      return;
    }

    if (nodes.length === 0 && edges.length === 0) {
      return;
    }

    const pendingOptions = pendingViewportFitRef.current;
    pendingViewportFitRef.current = null;

    void fitViewportToScene({
      duration: pendingOptions.duration,
      padding: pendingOptions.padding,
    }).then((nextViewport) => {
      if (!nextViewport || !pendingOptions.syncImportText) {
        return;
      }

      setImportText(
        stringifyGraphDocument({
          ...serializeDocument(),
          viewport: nextViewport,
        }),
      );
    });
  }, [edges.length, fitViewportToScene, flowInstance, nodes.length, serializeDocument]);

  useEffect(() => {
    if (suspendGestureHistoryRef.current) {
      return;
    }

    void commitHistorySnapshot();
  }, [commitHistorySnapshot]);

  useEffect(() => {
    return () => {
      if (historyFlushFrameRef.current && typeof window !== "undefined") {
        window.cancelAnimationFrame(historyFlushFrameRef.current);
      }
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleBeginHistoryGesture = () => {
      beginHistoryGesture();
    };

    const handleEndHistoryGesture = () => {
      endHistoryGesture();
    };

    window.addEventListener("icvn:begin-history-gesture", handleBeginHistoryGesture);
    window.addEventListener("icvn:end-history-gesture", handleEndHistoryGesture);

    return () => {
      window.removeEventListener("icvn:begin-history-gesture", handleBeginHistoryGesture);
      window.removeEventListener("icvn:end-history-gesture", handleEndHistoryGesture);
    };
  }, [beginHistoryGesture, endHistoryGesture]);


  const getCanvasCenterPosition = useCallback(() => {
    if (flowInstance && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      return flowInstance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }

    return { x: 320, y: 220 };
  }, [flowInstance]);

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!flowInstance || !canvasRef.current || shouldIgnoreCanvasGestureTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = canvasRef.current.getBoundingClientRect();
      const currentViewport = flowInstance.getViewport();
      const normalizedDelta =
        event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 120 : event.deltaY;
      const pointerFlowPosition = flowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const zoomFactor = Math.exp(-normalizedDelta * (event.ctrlKey ? 0.0032 : 0.0024));
      const nextZoom = clamp(currentViewport.zoom * zoomFactor, 0.15, 2.5);
      const nextViewport = {
        x: event.clientX - rect.left - pointerFlowPosition.x * nextZoom,
        y: event.clientY - rect.top - pointerFlowPosition.y * nextZoom,
        zoom: nextZoom,
      };

      applyViewport(nextViewport);
    },
    [applyViewport, flowInstance],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const isMiddleButton = event.button === 1;
      const isPrimaryButton = event.button === 0;
      const isBlankPrimaryPan = isPrimaryButton && !shouldIgnoreCanvasGestureTarget(event.target);
      const shouldTrackPointer = isMiddleButton || (isPrimaryButton && (isSpacePressed || isBlankPrimaryPan));

      if (!flowInstance || !shouldTrackPointer || isEditableTarget(event.target)) {
        return;
      }

      const pointerHost = event.currentTarget;
      const startViewport = flowInstance.getViewport();
      const startX = event.clientX;
      const startY = event.clientY;
      const dragThreshold = 4;
      let hasStartedPanning = isMiddleButton || isSpacePressed;

      if (hasStartedPanning) {
        event.preventDefault();
        pointerHost.setPointerCapture?.(event.pointerId);
        setIsCanvasPanning(true);
      }

      const beginPanning = () => {
        if (hasStartedPanning) {
          return;
        }

        hasStartedPanning = true;
        pointerHost.setPointerCapture?.(event.pointerId);
        setIsCanvasPanning(true);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        if (!hasStartedPanning) {
          if (!isBlankPrimaryPan || Math.hypot(deltaX, deltaY) < dragThreshold) {
            return;
          }

          beginPanning();
        }

        moveEvent.preventDefault();
        applyViewport({
          x: startViewport.x + deltaX,
          y: startViewport.y + deltaY,
          zoom: startViewport.zoom,
        });
      };

      const finishPanning = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishPanning);
        window.removeEventListener("pointercancel", finishPanning);

        if (pointerHost.hasPointerCapture?.(event.pointerId)) {
          pointerHost.releasePointerCapture(event.pointerId);
        }

        if (hasStartedPanning) {
          setIsCanvasPanning(false);
        }
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishPanning);
      window.addEventListener("pointercancel", finishPanning);
    },
    [applyViewport, flowInstance, isSpacePressed],
  );

  const handleUndo = useCallback(() => {
    if (historyRef.current.length <= 1) {
      return;
    }

    const current = historyRef.current.pop();
    if (!current) {
      return;
    }

    futureRef.current.unshift(structuredClone(current));
    const previous = structuredClone(historyRef.current[historyRef.current.length - 1]);
    applyDocument(previous, "已撤回上一步操作。", { suppressHistory: true });
    lastSnapshotRef.current = stringifyGraphDocument(previous);
    updateHistoryState();
  }, [applyDocument, updateHistoryState]);

  const handleRedo = useCallback(() => {
    const next = futureRef.current.shift();
    if (!next) {
      return;
    }

    historyRef.current.push(structuredClone(next));
    applyDocument(next, "已重做上一步操作。", { suppressHistory: true });
    lastSnapshotRef.current = stringifyGraphDocument(next);
    updateHistoryState();
  }, [applyDocument, updateHistoryState]);

  const handleAddShape = useCallback(
    (kind: ShapeNodeKind) => {
      const nextNode = createShapeNode(
        {
          position: getCanvasCenterPosition(),
          data: {
            kind,
            text: "",
          },
        },
        nodes.length,
      );

      setNodes((currentNodes) => [...currentNodes, nextNode]);
      syncSelectionState({
        nodeIds: [nextNode.id],
        edgeIds: [],
        primaryNodeId: nextNode.id,
        primaryEdgeId: null,
      });
      setStatus(`已添加${shapeOptions.find((item) => item.kind === kind)?.label ?? "图形"}，双击即可输入文字。`);
    },
    [getCanvasCenterPosition, nodes.length, setNodes, syncSelectionState],
  );

  const handleDuplicateSelectedNode = useCallback(() => {
    if (!selectedShapeNodes.length) {
      return;
    }

    const nextNodes = selectedShapeNodes.map((node, index) =>
      createShapeNode(
        {
          position: {
            x: node.position.x + 36,
            y: node.position.y + 36,
          },
          width: node.width,
          height: node.height,
          initialWidth: node.initialWidth,
          initialHeight: node.initialHeight,
          data: structuredClone(node.data),
        },
        nodes.length + index,
      ),
    );

    setNodes((currentNodes) => [...currentNodes, ...nextNodes]);
    syncSelectionState({
      nodeIds: nextNodes.map((node) => node.id),
      edgeIds: [],
      primaryNodeId: nextNodes[0]?.id ?? null,
      primaryEdgeId: null,
    });
    copiedNodeRef.current = nextNodes.map((node) => structuredClone(node));
    setStatus(nextNodes.length > 1 ? `已复制 ${nextNodes.length} 个图形。` : "已复制当前图形，可继续拖拽到目标位置。");
  }, [nodes.length, selectedShapeNodes, setNodes, syncSelectionState]);

  const handleCopySelectedNode = useCallback(() => {
    if (!selectedShapeNodes.length) {
      return;
    }

    copiedNodeRef.current = selectedShapeNodes.map((node) => structuredClone(node));
    setStatus(
      selectedShapeNodes.length > 1
        ? `已复制 ${selectedShapeNodes.length} 个图形，可使用 Ctrl/Cmd + V 粘贴。`
        : "已复制当前图形，可使用 Ctrl/Cmd + V 粘贴。",
    );
  }, [selectedShapeNodes]);

  const handlePasteCopiedNode = useCallback(() => {
    if (!copiedNodeRef.current.length) {
      setStatus("当前没有可粘贴的图形，请先复制一个或多个图形。");
      return;
    }

    const nextNodes = copiedNodeRef.current.map((copiedNode, index) =>
      createShapeNode(
        {
          position: {
            x: copiedNode.position.x + 40,
            y: copiedNode.position.y + 40,
          },
          width: copiedNode.width,
          height: copiedNode.height,
          initialWidth: copiedNode.initialWidth,
          initialHeight: copiedNode.initialHeight,
          data: structuredClone(copiedNode.data),
        },
        nodes.length + index,
      ),
    );

    setNodes((currentNodes) => [...currentNodes, ...nextNodes]);
    syncSelectionState({
      nodeIds: nextNodes.map((node) => node.id),
      edgeIds: [],
      primaryNodeId: nextNodes[0]?.id ?? null,
      primaryEdgeId: null,
    });
    copiedNodeRef.current = nextNodes.map((node) => structuredClone(node));
    setStatus(nextNodes.length > 1 ? `已粘贴 ${nextNodes.length} 个图形。` : "已粘贴图形副本。");
  }, [nodes.length, setNodes, syncSelectionState]);

  const handleNudgeSelectedNode = useCallback(
    (direction: "up" | "down" | "left" | "right", step: number) => {
      if (!selectedShapeNodes.length) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (!selectedNodeIds.includes(node.id) || node.type !== "shapeNode") {
            return node;
          }

          return {
            ...node,
            position: {
              x:
                direction === "left"
                  ? node.position.x - step
                  : direction === "right"
                    ? node.position.x + step
                    : node.position.x,
              y:
                direction === "up"
                  ? node.position.y - step
                  : direction === "down"
                    ? node.position.y + step
                    : node.position.y,
            },
          };
        }),
      );
    },
    [selectedNodeIds, selectedShapeNodes.length, setNodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId = selectedNodeId) => {
      if (!nodeId) {
        return;
      }

      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      );
      clearSelection();
      setStatus("已删除节点，并清理相关连线。");
    },
    [clearSelection, selectedNodeId, setEdges, setNodes],
  );

  const handleDeleteEdge = useCallback(
    (edgeId = selectedEdgeId) => {
      if (!edgeId) {
        return;
      }

      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      clearSelection();
      setStatus("已删除连线。");
    },
    [clearSelection, selectedEdgeId, setEdges],
  );

  const handleDeleteEdgeLabel = useCallback(
    (edgeId = selectedEdgeLabelId) => {
      if (!edgeId) {
        return;
      }

      setEdges((currentEdges) =>
        currentEdges.map((edge) =>
          edge.id === edgeId
            ? createRelationEdge({
                ...edge,
                id: edge.id,
                label: "",
                data: edge.data,
              })
            : edge,
        ),
      );
      clearSelection();
      setStatus("已删除说明文字，连线本体已保留。");
    },
    [clearSelection, selectedEdgeLabelId, setEdges],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!selectedNodeIds.length && !selectedEdgeIds.length) {
      return;
    }

    const nodeIdSet = new Set(selectedNodeIds);
    const edgeIdSet = new Set(selectedEdgeIds);

    setNodes((currentNodes) => currentNodes.filter((node) => !nodeIdSet.has(node.id)));
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => !edgeIdSet.has(edge.id) && !nodeIdSet.has(edge.source) && !nodeIdSet.has(edge.target),
      ),
    );
    clearSelection();
    setStatus(`已删除 ${selectedNodeIds.length} 个图形和 ${selectedEdgeIds.length} 条连线。`);
  }, [clearSelection, selectedEdgeIds, selectedNodeIds, setEdges, setNodes]);

  const handleDeleteCurrentSelection = useCallback(() => {
    if (selectedEdgeLabelId) {
      handleDeleteEdgeLabel(selectedEdgeLabelId);
      return;
    }

    handleDeleteSelection();
  }, [handleDeleteEdgeLabel, handleDeleteSelection, selectedEdgeLabelId]);

  const handleClearCanvas = useCallback(() => {
    if (isCanvasEmpty) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm("确认清空整个画布吗？\n\n这会删除所有图形和连线，但仍可通过撤销恢复。")
    ) {
      return;
    }

    const currentDocument = serializeDocument();
    applyDocument(
      {
        ...currentDocument,
        nodes: [],
        edges: [],
      },
      "已清空画布。",
    );
  }, [applyDocument, isCanvasEmpty, serializeDocument]);

  const handleOpenDocumentImportFromFileDialog = useCallback(() => {
    setIsFileDialogOpen(false);
    setIsDocumentImportDialogOpen(true);
  }, []);

  const handleCloseFileDialog = useCallback(() => {
    setIsFileDialogOpen(false);
    setRenamingFileId(null);
  }, []);

  const handleSelectWorkspaceFile = useCallback(
    (fileId: string) => {
      const nextSelectedFile = workspaceFilesRef.current.find((file) => file.id === fileId);
      if (!nextSelectedFile) {
        return;
      }

      setSelectedWorkspaceFileId(fileId);
      setRenameDraft(nextSelectedFile.name);
      setRenamingFileId(null);
    },
    [],
  );

  const syncWorkspaceTaskTitle = useCallback(
    async (fileId: string, nextTitle: string) => {
      const targetFile = workspaceFilesRef.current.find((file) => file.id === fileId);
      const taskId = targetFile?.taskId;

      if (!taskId) {
        return;
      }

      const currentTask = tasksRef.current.find((task) => task.id === taskId);
      if (currentTask?.title === nextTitle || pendingTaskTitleSyncRef.current.get(taskId) === nextTitle) {
        return;
      }

      pendingTaskTitleSyncRef.current.set(taskId, nextTitle);
      const optimisticUpdatedAt = new Date().toISOString();

      setTasks((current) =>
        sortRecordsByCreatedAtDesc(
          current.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  title: nextTitle,
                  updatedAt: optimisticUpdatedAt,
                }
              : task,
          ),
        ),
      );

      try {
        const updatedTask = await openApiClient.updateTask(taskId, { title: nextTitle });
        setTasks((current) => sortRecordsByCreatedAtDesc(current.map((task) => (task.id === taskId ? updatedTask : task))));
        void loadTaskList({ highlightTaskId: taskId, silent: true });
      } catch (error: unknown) {
        if (currentTask) {
          setTasks((current) => sortRecordsByCreatedAtDesc(current.map((task) => (task.id === taskId ? currentTask : task))));
        }

        setStatus(
          error instanceof Error
            ? `已更新名称为《${nextTitle}》，但任务标题同步失败：${error.message}`
            : `已更新名称为《${nextTitle}》，但任务标题同步失败，请稍后重试。`,
        );
      } finally {
        if (pendingTaskTitleSyncRef.current.get(taskId) === nextTitle) {
          pendingTaskTitleSyncRef.current.delete(taskId);
        }
      }
    },
    [loadTaskList, setStatus],
  );

  const commitCurrentFileName = useCallback(
    (nextName: string, options?: { announce?: string }) => {
      const normalizedName = normalizeGraphFileName(nextName);
      setCurrentFileName(normalizedName);
      currentFileNameRef.current = normalizedName;

      const { nextFiles } = syncCurrentFileSnapshot(serializeDocument(), { name: normalizedName });
      writeWorkspaceToStorage(nextFiles, activeFileIdRef.current, options);

      if (selectedWorkspaceFileId === activeFileIdRef.current) {
        setRenameDraft(normalizedName);
      }

      void syncWorkspaceTaskTitle(activeFileIdRef.current, normalizedName);

      return normalizedName;
    },
    [selectedWorkspaceFileId, serializeDocument, syncCurrentFileSnapshot, syncWorkspaceTaskTitle, writeWorkspaceToStorage],
  );

  const createWorkspaceCanvas = useCallback(
    (options?: { focusTitle?: boolean; openDialog?: boolean; renameInDialog?: boolean }) => {
      const { nextFiles: currentFiles } = syncCurrentFileSnapshot(serializeDocument(), {
        name: normalizeGraphFileName(currentFileNameRef.current),
      });
      const taskNames = tasksRef.current.map((task) => task.title);
      const nextFile = createWorkspaceFile({
        name: getNextUntitledFileName(taskNames),
        document: createEmptyGraphDocument(),
      });
      const nextFiles = [...currentFiles, nextFile];

      updateWorkspaceState(nextFiles, nextFile.id);
      setRenameDraft(nextFile.name);
      setRenamingFileId(options?.renameInDialog ? nextFile.id : null);
      writeWorkspaceToStorage(nextFiles, nextFile.id, { announce: `\u5df2\u521b\u5efa\u6587\u4ef6\u300a${nextFile.name}\u300b\u3002` });
      applyDocument(nextFile.document, `\u5df2\u5207\u6362\u5230\u300a${nextFile.name}\u300b\u3002`, { resetHistory: true });

      if (options?.openDialog) {
        setIsFileDialogOpen(true);
      }

      if (options?.focusTitle && typeof window !== "undefined") {
        window.setTimeout(() => {
          titleInputRef.current?.focus();
          titleInputRef.current?.select();
        }, 0);
      }

      return nextFile;
    },
    [applyDocument, serializeDocument, syncCurrentFileSnapshot, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const createEmptyTaskCanvas = useCallback(
    async (options?: { focusTitle?: boolean; openDialog?: boolean; renameInDialog?: boolean }) => {
      const nextFile = createWorkspaceCanvas(options);

      try {
        const task = await openApiClient.createDocumentTask({
          sourceType: "custom",
          title: nextFile.name,
        });

        bindTaskToWorkspaceFile(nextFile.id, task.id, { title: task.title });
        setTasks((current) => sortRecordsByCreatedAtDesc([task, ...current.filter((item) => item.id !== task.id)]));
        setSelectedTaskId(task.id);
        void loadTaskList({ highlightTaskId: task.id, silent: true });
        setStatus(`已创建任务《${task.title}》，并切换到新的空白画布。`);
      } catch (error: unknown) {
        setStatus(
          error instanceof Error
            ? `已创建空白画布，但任务创建失败：${error.message}`
            : "已创建空白画布，但任务创建失败，请稍后重试。",
        );
      }
    },
    [bindTaskToWorkspaceFile, createWorkspaceCanvas, loadTaskList],
  );

  const handleCreateFile = useCallback(async () => {
    await createEmptyTaskCanvas({ openDialog: true, renameInDialog: true });
  }, [createEmptyTaskCanvas]);

  const handleCreateCanvas = useCallback(async () => {
    await createEmptyTaskCanvas({ focusTitle: true });
  }, [createEmptyTaskCanvas]);

  const handleSwitchFile = useCallback(
    (fileId: string) => {
      const { nextFiles } = syncCurrentFileSnapshot(serializeDocument(), {
        name: normalizeGraphFileName(currentFileNameRef.current),
      });
      const nextFile = nextFiles.find((file) => file.id === fileId);

      if (!nextFile) {
        return;
      }

      updateWorkspaceState(nextFiles, nextFile.id);
      setRenameDraft(nextFile.name);
      setRenamingFileId(null);
      writeWorkspaceToStorage(nextFiles, nextFile.id, { announce: `\u5df2\u5207\u6362\u5230\u300a${nextFile.name}\u300b\u3002` });
      applyDocument(nextFile.document, `\u5df2\u5207\u6362\u5230\u300a${nextFile.name}\u300b\u3002`, { resetHistory: true });
      setIsFileDialogOpen(false);
    },
    [applyDocument, serializeDocument, syncCurrentFileSnapshot, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const handleSaveWorkspaceFilePreview = useCallback(() => {
    if (!selectedWorkspaceFile || !isSelectedWorkspaceFilePreviewDirty) {
      return;
    }

    try {
      const document = parseGraphDocument(selectedWorkspaceFilePreviewDraft);
      const baseFiles = syncCurrentFileSnapshot(serializeDocument(), {
        name: normalizeGraphFileName(currentFileNameRef.current),
      }).nextFiles;
      const nextFiles = baseFiles.map((file) =>
        file.id === selectedWorkspaceFile.id
          ? {
              ...file,
              document,
              updatedAt: new Date().toISOString(),
            }
          : file,
      );

      updateWorkspaceState(nextFiles, activeFileIdRef.current);
      writeWorkspaceToStorage(nextFiles, activeFileIdRef.current);
      setSelectedWorkspaceFilePreviewDraft(stringifyGraphDocument(document));

      if (selectedWorkspaceFile.id === activeFileIdRef.current) {
        applyDocument(document, `\u5df2\u4fdd\u5b58\u300a${selectedWorkspaceFile.name}\u300b\u7684 JSON \u4fee\u6539\u3002`, { resetHistory: true });
        return;
      }

      setStatus(`\u5df2\u4fdd\u5b58\u300a${selectedWorkspaceFile.name}\u300b\u7684 JSON \u4fee\u6539\u3002`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "\u4fdd\u5b58 JSON \u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 JSON \u7ed3\u6784\u3002");
    }
  }, [
    applyDocument,
    isSelectedWorkspaceFilePreviewDirty,
    selectedWorkspaceFile,
    selectedWorkspaceFilePreviewDraft,
    serializeDocument,
    syncCurrentFileSnapshot,
    updateWorkspaceState,
    writeWorkspaceToStorage,
  ]);

  const handleStartRenameWorkspaceFile = useCallback((fileId: string) => {
    const nextFile = workspaceFilesRef.current.find((file) => file.id === fileId);
    if (!nextFile) {
      return;
    }

    setSelectedWorkspaceFileId(fileId);
    setRenameDraft(nextFile.name);
    setRenamingFileId(fileId);
  }, []);

  const handleCommitRenameWorkspaceFile = useCallback(() => {
    if (!renamingFileId) {
      return;
    }

    const targetFile = workspaceFilesRef.current.find((file) => file.id === renamingFileId);
    if (!targetFile) {
      return;
    }

    const normalizedName = normalizeGraphFileName(renameDraft, targetFile.name);
    const baseFiles = syncCurrentFileSnapshot(serializeDocument(), {
      name:
        renamingFileId === activeFileIdRef.current
          ? normalizedName
          : normalizeGraphFileName(currentFileNameRef.current),
    }).nextFiles;
    const nextFiles = baseFiles.map((file) =>
      file.id === renamingFileId
        ? {
            ...file,
            name: normalizedName,
            updatedAt: new Date().toISOString(),
          }
        : file,
    );

    updateWorkspaceState(nextFiles, activeFileIdRef.current);
    writeWorkspaceToStorage(nextFiles, activeFileIdRef.current, { announce: `已重命名为《${normalizedName}》。` });
    setSelectedWorkspaceFileId(renamingFileId);
    setRenameDraft(normalizedName);
    setRenamingFileId(null);
    void syncWorkspaceTaskTitle(renamingFileId, normalizedName);

    if (renamingFileId === activeFileIdRef.current) {
      setCurrentFileName(normalizedName);
      currentFileNameRef.current = normalizedName;
    }
  }, [renameDraft, renamingFileId, serializeDocument, syncCurrentFileSnapshot, syncWorkspaceTaskTitle, updateWorkspaceState, writeWorkspaceToStorage]);

  useEffect(() => {
    if (!isFileDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseFileDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseFileDialog, isFileDialogOpen]);

  const handleDeleteWorkspaceFile = useCallback(
    (fileId: string) => {
      const targetFile = workspaceFilesRef.current.find((file) => file.id === fileId);
      if (!targetFile) {
        return;
      }

      if (
        typeof window !== "undefined" &&
        !window.confirm(`确认删除文件《${targetFile.name}》吗？\n\n删除后将无法直接恢复。`)
      ) {
        return;
      }

      const shouldCaptureCurrentFile = fileId !== activeFileIdRef.current;
      const baseFiles = shouldCaptureCurrentFile
        ? syncCurrentFileSnapshot(serializeDocument(), { name: normalizeGraphFileName(currentFileNameRef.current) }).nextFiles
        : workspaceFilesRef.current;

      let nextFiles = baseFiles.filter((file) => file.id !== fileId);

      if (nextFiles.length === 0) {
        const replacementFile = createWorkspaceFile({
          name: getNextUntitledFileName(tasksRef.current.map((task) => task.title)),
          document: createEmptyGraphDocument(),
        });
        nextFiles = [replacementFile];
        updateWorkspaceState(nextFiles, replacementFile.id);
        setRenameDraft(replacementFile.name);
        setRenamingFileId(null);
        writeWorkspaceToStorage(nextFiles, replacementFile.id, { announce: `已删除《${targetFile.name}》，并创建新的空白文件。` });
        applyDocument(replacementFile.document, `已切换到《${replacementFile.name}》。`, { resetHistory: true });
        return;
      }

      if (fileId === activeFileIdRef.current) {
        const fallbackFile = nextFiles[0];
        updateWorkspaceState(nextFiles, fallbackFile.id);
        setRenameDraft(fallbackFile.name);
        setRenamingFileId(null);
        writeWorkspaceToStorage(nextFiles, fallbackFile.id, { announce: `已删除《${targetFile.name}》。` });
        applyDocument(fallbackFile.document, `已切换到《${fallbackFile.name}》。`, { resetHistory: true });
        return;
      }

      updateWorkspaceState(nextFiles, activeFileIdRef.current);
      setSelectedWorkspaceFileId(activeFileIdRef.current);
      setRenameDraft(currentFileNameRef.current);
      setRenamingFileId(null);
      writeWorkspaceToStorage(nextFiles, activeFileIdRef.current, { announce: `已删除《${targetFile.name}》。` });
    },
    [applyDocument, serializeDocument, syncCurrentFileSnapshot, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const handleSelectAll = useCallback(() => {
    const nextNodeIds = nodes.map((node) => node.id);
    const nextEdgeIds = edges.map((edge) => edge.id);

    syncSelectionState({
      nodeIds: nextNodeIds,
      edgeIds: nextEdgeIds,
      primaryNodeId: nextNodeIds[0] ?? null,
      primaryEdgeId: nextEdgeIds[0] ?? null,
    });
    setStatus(`已全选 ${nextNodeIds.length} 个图形和 ${nextEdgeIds.length} 条连线。`);
  }, [edges, nodes, syncSelectionState]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const duplicatedEdge = edges.find(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          edge.sourceHandle === (connection.sourceHandle ?? undefined) &&
          edge.targetHandle === (connection.targetHandle ?? undefined),
      );

      if (duplicatedEdge) {
        syncSelectionState({
          nodeIds: [],
          edgeIds: [duplicatedEdge.id],
          primaryNodeId: null,
          primaryEdgeId: duplicatedEdge.id,
        });
        setStatus("这些连接点之间已存在连线，已为你选中现有连线。");
        return;
      }

      const nextEdge = createRelationEdge(
        {
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
          label: "",
          data: {
            pathStyle: "smoothstep",
            dashed: false,
            marker: "none",
            isEventEdge: true,
            eventOverview: "",
            eventDescription: "",
            eventName1: getNodeEventDisplayName(connection.source),
            eventName2: getNodeEventDisplayName(connection.target),
          },
        },
        edges.length,
      );

      setEdges((currentEdges) => addEdge(nextEdge, currentEdges));
      syncSelectionState({
        nodeIds: [],
        edgeIds: [nextEdge.id],
        primaryNodeId: null,
        primaryEdgeId: nextEdge.id,
      });
      setStatus("已新增事件连线，可直接填写事件概述和完整描述。");
    },
    [edges, getNodeEventDisplayName, setEdges, syncSelectionState],
  );

  const handleReconnect = useCallback(
    (oldEdge: AppEdge, connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const duplicatedEdge = edges.find(
        (edge) =>
          edge.id !== oldEdge.id &&
          edge.source === connection.source &&
          edge.target === connection.target &&
          edge.sourceHandle === (connection.sourceHandle ?? undefined) &&
          edge.targetHandle === (connection.targetHandle ?? undefined),
      );

      if (duplicatedEdge) {
        syncSelectionState({
          nodeIds: [],
          edgeIds: [duplicatedEdge.id],
          primaryNodeId: null,
          primaryEdgeId: duplicatedEdge.id,
        });
        setStatus("目标连接点之间已存在相同的连线，已保留原有连线。");
        return;
      }

      setEdges((currentEdges) =>
        currentEdges.map((edge) =>
          edge.id === oldEdge.id
            ? createRelationEdge({
                ...edge,
                id: edge.id,
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle ?? undefined,
                targetHandle: connection.targetHandle ?? undefined,
                label: typeof edge.label === "string" ? edge.label : "",
                data: edge.data,
              })
            : edge,
        ),
      );
      syncSelectionState({
        nodeIds: [],
        edgeIds: [oldEdge.id],
        primaryNodeId: null,
        primaryEdgeId: oldEdge.id,
      });
      setStatus("已重新挂接连线端点。");
    },
    [edges, setEdges, syncSelectionState],
  );
  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams<Node, AppEdge>) => {
      const nextNodeIds = params.nodes.map((node) => node.id);
      const nextEdgeIds = params.edges.map((edge) => edge.id);

      if (
        suppressNextEmptySelectionRef.current &&
        nextNodeIds.length === 0 &&
        nextEdgeIds.length === 0
      ) {
        suppressNextEmptySelectionRef.current = false;
        return;
      }

      suppressNextEmptySelectionRef.current = false;

      syncSelectionState({
        nodeIds: nextNodeIds,
        edgeIds: nextEdgeIds,
        primaryNodeId: nextNodeIds[0] ?? null,
        primaryEdgeId: nextNodeIds.length ? null : (nextEdgeIds[0] ?? null),
      });
    },
    [syncSelectionState],
  );

  const prepareAutoLayoutDocument = useCallback(async (document: GraphDocument) => {
    try {
      return {
        document: await layoutGraphDocument(document),
        didAutoLayout: true,
      };
    } catch {
      return {
        document,
        didAutoLayout: false,
      };
    }
  }, []);

  const runAutoLayout = useCallback(
    async (
      document: GraphDocument,
      messages: {
        start: string;
        success: string;
        failure: string;
      },
    ): Promise<GraphDocument> => {
      setIsImportingLayout(true);
      setStatus(messages.start);

      try {
        const { document: nextDocument, didAutoLayout } = await withTimeout(
          prepareAutoLayoutDocument(document),
          CANVAS_LOAD_TIMEOUT_MS,
          "\u81ea\u52a8\u5e03\u5c40\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\u672c\u6b21\u5e03\u5c40\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
        );
        const nextStatus = didAutoLayout ? messages.success : messages.failure;

        applyDocument(nextDocument, nextStatus);
        let finalDocument = nextDocument;
        const nextViewport = await fitViewportToScene({ duration: 320, padding: 0.2 });
        if (nextViewport) {
          finalDocument = {
            ...nextDocument,
            viewport: nextViewport,
          };
          setImportText(stringifyGraphDocument(finalDocument));
        } else if (nextDocument.nodes.length > 0 || nextDocument.edges.length > 0) {
          pendingViewportFitRef.current = { duration: 320, padding: 0.2, syncImportText: true };
        }

        return finalDocument;
      } finally {
        setIsImportingLayout(false);
      }
    },
    [applyDocument, fitViewportToScene, prepareAutoLayoutDocument],
  );

  const {
    documentImportInputRef,
    documentImportItems,
    isDocumentProcessing,
    isDocumentDragActive,
    setIsDocumentDragActive,
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
  } = useDocumentImportFlow({
    setStatus,
    parseGraphDocument,
    runAutoLayout,
    onTaskChange: (taskId) => {
      const targetFileId = activeFileIdRef.current;
      setSelectedTaskId(taskId);
      void loadTaskList({ highlightTaskId: taskId, silent: true }).then((items) => {
        const task = items.find((item) => item.id === taskId);
        if (!task || !["validated", "applied"].includes(task.status)) {
          return;
        }

        bindTaskToWorkspaceFile(targetFileId, task.id, {
          title: task.title,
          switchToFile: activeFileIdRef.current === targetFileId,
        });
      });
    },
    onProcessingCompleted: (taskId) => {
      setIsDocumentImportDialogOpen(false);
      void handleLoadTaskToCanvasRef.current(taskId);
    },
  });

  const handleLoadTaskToCanvas = useCallback(
    async (taskId: string) => {
      if (loadingTaskIdRef.current) {
        return false;
      }

      blockedAutoLoadTaskIdsRef.current.delete(taskId);
      loadingTaskIdRef.current = taskId;
      setLoadingTaskId(taskId);
      setSelectedTaskId(taskId);

      syncCurrentFileSnapshot(serializeDocument(), {
        name: normalizeGraphFileName(currentFileNameRef.current),
      });

      try {
        const detail = await withTimeout(
          openApiClient.getTaskDetail(taskId),
          CANVAS_LOAD_TIMEOUT_MS,
          "\u52a0\u8f7d\u4efb\u52a1\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\u672c\u6b21\u753b\u5e03\u52a0\u8f7d\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
        );
        const targetTask = detail ?? tasksRef.current.find((task) => task.id === taskId) ?? null;
        const localWorkspaceFile = targetTask ? ensureWorkspaceFileForTask(targetTask, { switchToFile: true }) : null;
        const taskTitle = targetTask?.title ?? taskId;
        const applyLocalWorkspaceFallback = (message: string) => {
          if (localWorkspaceFile) {
            applyDocument(localWorkspaceFile.document, message, {
              resetHistory: true,
            });
            return true;
          }

          setStatus(message);
          return false;
        };

        if (targetTask?.status === "failed") {
          setStatus(targetTask.errorMessage || `\u52a0\u8f7d\u4efb\u52a1 ${targetTask.title} \u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002`);
          void loadTaskList({ highlightTaskId: taskId, silent: true });
          return false;
        }

        if (targetTask && !["validated", "applied"].includes(targetTask.status)) {
          const didFallback = applyLocalWorkspaceFallback(`\u5df2\u5207\u6362\u5230\u4efb\u52a1 ${targetTask.title} \u7684\u672c\u5730\u753b\u5e03\u3002`);
          void loadTaskList({ highlightTaskId: taskId, silent: true });
          return didFallback;
        }

        const result = await withTimeout(
          openApiClient.getTaskResult(taskId),
          CANVAS_LOAD_TIMEOUT_MS,
          `\u52a0\u8f7d\u4efb\u52a1\u300a${taskTitle}\u300b\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\u672c\u6b21\u753b\u5e03\u52a0\u8f7d\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002`,
        );
        if (!Array.isArray(result.result?.nodes) || !Array.isArray(result.result?.edges)) {
          const didFallback = applyLocalWorkspaceFallback(`\u4efb\u52a1\u300a${taskTitle}\u300b\u6682\u65e0\u53ef\u52a0\u8f7d\u7684\u5173\u7cfb\u56fe\u7ed3\u679c\u3002`);
          void loadTaskList({ highlightTaskId: taskId, silent: true });
          return didFallback;
        }

        const importedDocument = parseGraphDocument(
          JSON.stringify({
            data: result.result,
          }),
        );
        assertGraphDocumentCanBeImported(importedDocument, `\u4efb\u52a1\u300a${taskTitle}\u300b\u7684\u5173\u7cfb\u56fe\u7ed3\u679c`);

        if (hasStoredNodePositions(importedDocument)) {
          applyDocument(importedDocument, `\u5df2\u52a0\u8f7d ${taskTitle} \u7684\u5173\u7cfb\u56fe\u3002`, {
            resetHistory: true,
          });

          const nextViewport = await fitViewportToScene({ duration: 320, padding: 0.2 });
          if (nextViewport) {
            setImportText(
              stringifyGraphDocument({
                ...importedDocument,
                viewport: nextViewport,
              }),
            );
          } else if (importedDocument.nodes.length > 0 || importedDocument.edges.length > 0) {
            pendingViewportFitRef.current = { duration: 320, padding: 0.2, syncImportText: true };
          }
        } else {
          setIsImportingLayout(true);
          setStatus(`\u6b63\u5728\u52a0\u8f7d ${taskTitle} \u7684\u5173\u7cfb\u56fe...`);

          try {
            const prepared = await withTimeout(
              prepareAutoLayoutDocument(importedDocument),
              CANVAS_LOAD_TIMEOUT_MS,
              `\u52a0\u8f7d\u4efb\u52a1\u300a${taskTitle}\u300b\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\u672c\u6b21\u753b\u5e03\u52a0\u8f7d\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002`,
            );
            const nextStatus = prepared.didAutoLayout
              ? `\u5df2\u52a0\u8f7d ${taskTitle} \u7684\u5173\u7cfb\u56fe\u3002`
              : `\u52a0\u8f7d ${taskTitle} \u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u5f53\u524d\u753b\u5e03\u3002`;

            applyDocument(prepared.document, nextStatus);
            let finalDocument = prepared.document;
            const nextViewport = await fitViewportToScene({ duration: 320, padding: 0.2 });
            if (nextViewport) {
              finalDocument = {
                ...prepared.document,
                viewport: nextViewport,
              };
              setImportText(stringifyGraphDocument(finalDocument));
            } else if (prepared.document.nodes.length > 0 || prepared.document.edges.length > 0) {
              pendingViewportFitRef.current = { duration: 320, padding: 0.2, syncImportText: true };
            }
          } finally {
            setIsImportingLayout(false);
          }
        }

        blockedAutoLoadTaskIdsRef.current.delete(taskId);
        void loadTaskList({ highlightTaskId: taskId, silent: true });
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "\u52a0\u8f7d\u4efb\u52a1\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002";
        const targetTask = tasksRef.current.find((task) => task.id === taskId) ?? null;
        const localWorkspaceFile = targetTask ? ensureWorkspaceFileForTask(targetTask, { switchToFile: true }) : null;

        if (message.includes("Task result is not ready")) {
          if (localWorkspaceFile) {
            applyDocument(localWorkspaceFile.document, `\u5df2\u5207\u6362\u5230\u4efb\u52a1 ${targetTask?.title ?? taskId} \u7684\u672c\u5730\u753b\u5e03\u3002`, {
              resetHistory: true,
            });
            void loadTaskList({ highlightTaskId: taskId, silent: true });
            return true;
          }

          setStatus(
            targetTask
              ? `\u4efb\u52a1 ${targetTask.title} \u6682\u65e0\u53ef\u52a0\u8f7d\u7684\u5173\u7cfb\u56fe\u3002`
              : "\u5f53\u524d\u4efb\u52a1\u6682\u65e0\u53ef\u52a0\u8f7d\u7684\u5173\u7cfb\u56fe\u3002",
          );
          void loadTaskList({ highlightTaskId: taskId, silent: true });
          return false;
        }

        blockedAutoLoadTaskIdsRef.current.add(taskId);

        if (localWorkspaceFile && /(\u4e0d\u7b26\u5408\u5bfc\u5165\u89c4\u8303|\u8d85\u65f6)/u.test(message)) {
          applyDocument(localWorkspaceFile.document, `${message} \u5df2\u5207\u6362\u5230\u4efb\u52a1\u300a${targetTask?.title ?? taskId}\u300b\u7684\u672c\u5730\u753b\u5e03\u3002`, {
            resetHistory: true,
          });
        } else {
          setStatus(message);
        }

        void loadTaskList({ highlightTaskId: taskId, silent: true });
        return false;
      } finally {
        loadingTaskIdRef.current = null;
        setLoadingTaskId(null);
      }
    },
    [
      applyDocument,
      ensureWorkspaceFileForTask,
      fitViewportToScene,
      loadTaskList,
      prepareAutoLayoutDocument,
      serializeDocument,
      syncCurrentFileSnapshot,
    ],
  );
  const handleLoadTaskToCanvasRef = useRef(handleLoadTaskToCanvas);
  useEffect(() => {
    handleLoadTaskToCanvasRef.current = handleLoadTaskToCanvas;
  }, [handleLoadTaskToCanvas]);

  const applyDocumentRef = useRef(applyDocument);
  useEffect(() => {
    applyDocumentRef.current = applyDocument;
  }, [applyDocument]);

  const restoreWorkspaceFromLocalCacheRef = useRef(restoreWorkspaceFromLocalCache);
  useEffect(() => {
    restoreWorkspaceFromLocalCacheRef.current = restoreWorkspaceFromLocalCache;
  }, [restoreWorkspaceFromLocalCache]);

  useEffect(() => {
    if (hasInitializedFromDatabaseRef.current) {
      return;
    }

    hasInitializedFromDatabaseRef.current = true;
    let cancelled = false;

    const initializeCanvas = async () => {
      let hasLoadedInitialCanvas = false;
      let shouldRestoreLocalCanvas = true;

      const loadFirstTaskWorkspace = (task: Task) => {
        restoreWorkspaceFromLocalCacheRef.current({ applyCanvas: false });
        const initialWorkspaceFile = ensureWorkspaceFileForTaskRef.current(task, { switchToFile: true });

        if (!initialWorkspaceFile) {
          return;
        }

        applyDocumentRef.current(initialWorkspaceFile.document, `已切换到任务《${task.title}》的本地画布。`, {
          resetHistory: true,
        });
        setSelectedTaskId(task.id);
        hasLoadedInitialCanvas = true;
      };

      try {
        const taskItems = await withTimeout(
          loadTaskList({ silent: true, preserveCurrentSelection: false }),
          CANVAS_LOAD_TIMEOUT_MS,
          "初始化任务列表超时，已恢复本地画布。",
        );
        if (cancelled) {
          return;
        }

        const firstTask = taskItems[0] ?? null;
        if (firstTask) {
          pruneRedundantDefaultWorkspaceFiles();
          shouldRestoreLocalCanvas = false;
          setSelectedTaskId(firstTask.id);

          if (["validated", "applied"].includes(firstTask.status)) {
            const didLoadInitialTask = await handleLoadTaskToCanvasRef.current(firstTask.id);
            if (didLoadInitialTask) {
              hasLoadedInitialCanvas = true;
              return;
            }
          }

          if (cancelled) {
            return;
          }

          loadFirstTaskWorkspace(firstTask);
          return;
        }

        const graphView = await withTimeout(
          openApiClient.getGraphView(BACKEND_GRAPH_ID),
          CANVAS_LOAD_TIMEOUT_MS,
          "从数据库加载画布超时，已恢复本地画布。",
        );
        if (cancelled) {
          return;
        }

        if (graphView.nodes.length > 0 || graphView.edges.length > 0) {
          const importedDocument = parseGraphDocument(
            JSON.stringify({
              data: graphView,
            }),
          );
          assertGraphDocumentCanBeImported(importedDocument, "数据库中的关系图");
          const { nextFile, nextFiles } = syncCurrentFileSnapshot(importedDocument, {
            name: normalizeGraphFileName(currentFileNameRef.current),
          });
          writeWorkspaceToStorage(nextFiles, nextFile.id);
          applyDocumentRef.current(importedDocument, "已从数据库加载实际关系图。", { resetHistory: true });
          hasLoadedInitialCanvas = true;
          shouldRestoreLocalCanvas = false;
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "从数据库加载关系图失败，请稍后重试。");
        }
      } finally {
        if (!cancelled && !hasLoadedInitialCanvas && shouldRestoreLocalCanvas) {
          restoreWorkspaceFromLocalCacheRef.current();
        }

        if (!cancelled) {
          setHasCompletedInitialLoad(true);
        }
      }
    };

    void initializeCanvas();

    return () => {
      cancelled = true;
    };
  }, [
    loadTaskList,
    pruneRedundantDefaultWorkspaceFiles,
    syncCurrentFileSnapshot,
    updateWorkspaceState,
    writeWorkspaceToStorage,
  ]);

  useEffect(() => {
    if (!hasCompletedInitialLoad || !flowInstance || !selectedTaskId) {
      return;
    }

    if (blockedAutoLoadTaskIdsRef.current.has(selectedTaskId)) {
      return;
    }

    const selectedTask = tasksRef.current.find((task) => task.id === selectedTaskId) ?? null;
    if (!selectedTask || !["validated", "applied"].includes(selectedTask.status)) {
      return;
    }

    if (nodes.length > 0 || edges.length > 0) {
      initialTaskAutoLoadRetryRef.current = selectedTaskId;
      return;
    }

    if (initialTaskAutoLoadRetryRef.current === selectedTaskId) {
      return;
    }

    initialTaskAutoLoadRetryRef.current = selectedTaskId;
    void handleLoadTaskToCanvasRef.current(selectedTaskId);
  }, [edges.length, flowInstance, hasCompletedInitialLoad, nodes.length, selectedTaskId]);
  const handleDeleteTask = useCallback(
    async (task: Task) => {
      const confirmMessage =
        task.status === "applied"
          ? `确认删除任务《${task.title}》吗？

删除后将一并清除数据库中的任务结果、已入图数据以及关联本地文件，且无法恢复。`
          : `确认删除任务《${task.title}》吗？

删除后将清除任务记录、结果以及关联本地文件，且无法恢复。`;
      if (!window.confirm(confirmMessage)) {
        return;
      }

      setDeletingTaskId(task.id);

      const previousTasks = tasksRef.current;
      const taskIndex = previousTasks.findIndex((item) => item.id === task.id);
      const remainingTasks = previousTasks.filter((item) => item.id !== task.id);
      const preferredNextTask =
        taskIndex >= 0 ? remainingTasks[taskIndex] ?? remainingTasks[taskIndex - 1] ?? null : remainingTasks[0] ?? null;
      const nextSelectedTaskId = preferredNextTask?.id ?? null;
      const linkedWorkspaceFile = workspaceFilesRef.current.find((file) => file.taskId === task.id) ?? null;
      const wasSelectedTask = selectedTaskId === task.id;

      const removeDeletedTaskWorkspaceFile = () => {
        if (!linkedWorkspaceFile) {
          return;
        }

        let nextFiles = workspaceFilesRef.current.filter((file) => file.id !== linkedWorkspaceFile.id);

        if (nextFiles.length === 0) {
          const replacementFile = createWorkspaceFile({
            name: getNextUntitledFileName(remainingTasks.map((item) => item.title)),
            document: createEmptyGraphDocument(),
          });
          nextFiles = [replacementFile];
          updateWorkspaceState(nextFiles, replacementFile.id);
          setRenameDraft(replacementFile.name);
          setRenamingFileId(null);
          writeWorkspaceToStorage(nextFiles, replacementFile.id);

          if (!nextSelectedTaskId) {
            applyDocument(replacementFile.document, `删除成功，已删除任务《${task.title}》，当前已切换到新的空白画布。`, {
              resetHistory: true,
            });
          }
          return;
        }

        if (linkedWorkspaceFile.id === activeFileIdRef.current) {
          const fallbackFile = nextFiles.find((file) => file.taskId === nextSelectedTaskId) ?? nextFiles[0];
          updateWorkspaceState(nextFiles, fallbackFile.id);
          setRenameDraft(fallbackFile.name);
          setRenamingFileId(null);
          writeWorkspaceToStorage(nextFiles, fallbackFile.id);

          if (!nextSelectedTaskId) {
            applyDocument(fallbackFile.document, `删除成功，已删除任务《${task.title}》，当前已切换到《${fallbackFile.name}》。`, {
              resetHistory: true,
            });
          }
          return;
        }

        updateWorkspaceState(nextFiles, activeFileIdRef.current);
        setRenameDraft(currentFileNameRef.current);
        setRenamingFileId(null);
        writeWorkspaceToStorage(nextFiles, activeFileIdRef.current);
      };

      try {
        await openApiClient.deleteTask(task.id);
        tasksRef.current = remainingTasks;
        setTasks(sortRecordsByCreatedAtDesc(remainingTasks));
        setSelectedTaskId((current) => (current === task.id ? nextSelectedTaskId : current));

        if (wasSelectedTask && nextSelectedTaskId) {
          await handleLoadTaskToCanvasRef.current(nextSelectedTaskId);
          removeDeletedTaskWorkspaceFile();
          setStatus(`删除成功，已删除任务《${task.title}》，当前已切换到《${preferredNextTask?.title ?? "未命名任务"}》。`);
          return;
        }

        removeDeletedTaskWorkspaceFile();
        setStatus(`删除成功，已删除任务《${task.title}》。`);
        void loadTaskList({ highlightTaskId: nextSelectedTaskId ?? undefined, silent: true });
      } catch (error: unknown) {
        setStatus(error instanceof Error ? error.message : "删除任务失败，请稍后重试。");
      } finally {
        setDeletingTaskId(null);
      }
    },
    [applyDocument, loadTaskList, selectedTaskId, updateWorkspaceState, writeWorkspaceToStorage],
  );
  const handleRenameTask = useCallback(
    async (task: Task, nextTitle: string) => {
      const normalizedName = normalizeGraphFileName(nextTitle, task.title);
      if (normalizedName === task.title) {
        return;
      }

      const optimisticUpdatedAt = new Date().toISOString();
      const previousWorkspaceFiles = workspaceFilesRef.current;
      const linkedWorkspaceFile = previousWorkspaceFiles.find((file) => file.taskId === task.id) ?? null;

      setTasks((current) =>
        sortRecordsByCreatedAtDesc(
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  title: normalizedName,
                  updatedAt: optimisticUpdatedAt,
                }
              : item,
          ),
        ),
      );

      if (linkedWorkspaceFile) {
        const nextFiles = previousWorkspaceFiles.map((file) =>
          file.id === linkedWorkspaceFile.id
            ? {
                ...file,
                name: normalizedName,
                updatedAt: optimisticUpdatedAt,
              }
            : file,
        );

        updateWorkspaceState(nextFiles, activeFileIdRef.current);
        writeWorkspaceToStorage(nextFiles, activeFileIdRef.current);

        if (linkedWorkspaceFile.id === activeFileIdRef.current) {
          setCurrentFileName(normalizedName);
          currentFileNameRef.current = normalizedName;
        }

        if (selectedWorkspaceFileId === linkedWorkspaceFile.id) {
          setRenameDraft(normalizedName);
        }
      }

      try {
        const updatedTask = await openApiClient.updateTask(task.id, { title: normalizedName });
        setTasks((current) => sortRecordsByCreatedAtDesc(current.map((item) => (item.id === task.id ? updatedTask : item))));

        if (linkedWorkspaceFile) {
          const syncedFiles = workspaceFilesRef.current.map((file) =>
            file.id === linkedWorkspaceFile.id
              ? {
                  ...file,
                  name: normalizedName,
                  updatedAt: updatedTask.updatedAt,
                }
              : file,
          );

          updateWorkspaceState(syncedFiles, activeFileIdRef.current);
          writeWorkspaceToStorage(syncedFiles, activeFileIdRef.current);
        }

        setStatus(`任务《${task.title}》已重命名为《${normalizedName}》。`);
        void loadTaskList({ highlightTaskId: task.id, silent: true });
      } catch (error: unknown) {
        setTasks((current) => sortRecordsByCreatedAtDesc(current.map((item) => (item.id === task.id ? task : item))));

        if (linkedWorkspaceFile) {
          updateWorkspaceState(previousWorkspaceFiles, activeFileIdRef.current);
          writeWorkspaceToStorage(previousWorkspaceFiles, activeFileIdRef.current);

          if (linkedWorkspaceFile.id === activeFileIdRef.current) {
            setCurrentFileName(linkedWorkspaceFile.name);
            currentFileNameRef.current = linkedWorkspaceFile.name;
          }

          if (selectedWorkspaceFileId === linkedWorkspaceFile.id) {
            setRenameDraft(linkedWorkspaceFile.name);
          }
        }

        const message = error instanceof Error ? error.message : "重命名任务失败，请稍后重试。";
        setStatus(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [loadTaskList, selectedWorkspaceFileId, updateWorkspaceState, writeWorkspaceToStorage],
  );

  const handleRenameSelectedTask = useCallback(async () => {
    if (!selectedTaskId) {
      setStatus("请先在任务列表中选中一个任务。")
      return;
    }

    const targetTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
    if (!targetTask) {
      setStatus("当前选中的任务不存在，请刷新后重试。")
      return;
    }

    const nextTitle = window.prompt("请输入新的任务名称", targetTask.title);
    if (nextTitle === null) {
      return;
    }

    await handleRenameTask(targetTask, nextTitle);
  }, [handleRenameTask, selectedTaskId, tasks]);

  const handleOpenDocumentImportDialog = useCallback(() => {
    setIsDocumentImportDialogOpen(true);
  }, []);

  const handleCloseDocumentImportDialog = useCallback(() => {
    if (isDocumentProcessing) {
      return;
    }

    setIsDocumentDragActive(false);
    setIsDocumentImportDialogOpen(false);
  }, [isDocumentProcessing, setIsDocumentDragActive]);

  const handleOpenJsonImportDialog = useCallback(() => {
    setIsImportDialogOpen(true);
  }, []);

  const handleImport = useCallback(async () => {
    if (isImportingLayout || isSavingToDatabase) {
      return;
    }

    try {
      const document = parseGraphDocument(importText);
      assertGraphDocumentCanBeImported(document, "\u5bfc\u5165 JSON");
      setIsImportingLayout(true);
      setStatus("JSON 解析成功，正在自动整理布局...");

      let persistedDocument: GraphDocument;
      let didAutoLayout = true;

      try {
        const prepared = await withTimeout(
          prepareAutoLayoutDocument(document),
          CANVAS_LOAD_TIMEOUT_MS,
          "\u5bfc\u5165\u5e03\u5c40\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5 JSON \u5185\u5bb9\u540e\u91cd\u8bd5\u3002",
        );
        persistedDocument = prepared.document;
        didAutoLayout = prepared.didAutoLayout;
      } finally {
        setIsImportingLayout(false);
      }

      setIsSavingToDatabase(true);

      try {
        const normalizedName = normalizeGraphFileName(currentFileNameRef.current);
        let taskId = activeWorkspaceFile?.taskId?.trim() ?? "";

        if (!taskId) {
          const task = await openApiClient.createDocumentTask({
            sourceType: "custom",
            title: normalizedName,
          });

          bindTaskToWorkspaceFile(activeFileIdRef.current, task.id, {
            title: task.title,
            switchToFile: true,
          });
          setTasks((current) => sortRecordsByCreatedAtDesc([task, ...current.filter((item) => item.id !== task.id)]));
          taskId = task.id;
        }

        const persistedResult = buildTaskResultFromGraphDocument(persistedDocument, {
          graphId: BACKEND_GRAPH_ID,
          sourceType: "import",
        });

        await openApiClient.saveTaskResult(taskId, { result: persistedResult });
        await openApiClient.applyTaskResult(taskId);

        applyDocument(
          persistedDocument,
          didAutoLayout ? "JSON 已保存到数据库，正在导入画布。" : "JSON 已保存到数据库，自动布局失败，正在导入原始坐标。",
        );

        let finalDocument = persistedDocument;
        const nextViewport = await fitViewportToScene({ duration: 320, padding: 0.2 });
        if (nextViewport) {
          finalDocument = {
            ...persistedDocument,
            viewport: nextViewport,
          };
        } else if (persistedDocument.nodes.length > 0 || persistedDocument.edges.length > 0) {
          pendingViewportFitRef.current = { duration: 320, padding: 0.2, syncImportText: true };
        }

        persistToLocalStorage(finalDocument, {
          syncImportText: true,
        });

        setSelectedTaskId(taskId);
        await loadTaskList({ highlightTaskId: taskId, silent: true });
        setStatus(
          didAutoLayout
            ? `JSON 已保存并导入《${normalizedName}》。`
            : `JSON 已保存并导入《${normalizedName}》，但自动布局失败，已保留原始坐标。`,
        );
        setIsImportDialogOpen(false);
      } finally {
        setIsSavingToDatabase(false);
      }
    } catch (error: unknown) {
      setStatus(
        error instanceof Error
          ? error.message
          : "\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 JSON \u7ed3\u6784\u3002\u652f\u6301 nodes + edges\u3001data.nodes + data.edges\u3001result.nodes + result.edges \u4ee5\u53ca AI \u539f\u59cb\u7ed3\u679c\u3002",
      );
      setIsImportingLayout(false);
    }
  }, [
    activeWorkspaceFile,
    applyDocument,
    bindTaskToWorkspaceFile,
    fitViewportToScene,
    importText,
    isImportingLayout,
    isSavingToDatabase,
    loadTaskList,
    persistToLocalStorage,
    prepareAutoLayoutDocument,
  ]);

  const handleCloseImportDialog = useCallback(() => {
    if (isImportingLayout || isSavingToDatabase) {
      return;
    }

    setIsImportDialogOpen(false);
  }, [isImportingLayout, isSavingToDatabase]);

  const handleRelayout = useCallback(async () => {
    if (shapeNodeCount === 0) {
      setStatus("\u5f53\u524d\u753b\u5e03\u4e3a\u7a7a\uff0c\u65e0\u9700\u6574\u7406\u5e03\u5c40\u3002");
      return;
    }

    if (shapeNodeCount === 1) {
      const nextViewport = await fitViewportToScene();
      if (nextViewport) {
        setImportText(
          stringifyGraphDocument({
            ...serializeDocument(),
            viewport: nextViewport,
          }),
        );
        setStatus("\u5f53\u524d\u53ea\u6709\u4e00\u4e2a\u56fe\u5f62\uff0c\u5df2\u81ea\u52a8\u9002\u914d\u89c6\u56fe\u3002");
      }
      return;
    }

    await runAutoLayout(serializeDocument(), {
      start: "\u6b63\u5728\u6574\u7406\u5f53\u524d\u5173\u7cfb\u56fe\u5e03\u5c40...",
      success: "\u5df2\u91cd\u65b0\u6574\u7406\u5f53\u524d\u5173\u7cfb\u56fe\u5e03\u5c40\u3002",
      failure: "\u6574\u7406\u5e03\u5c40\u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u5f53\u524d\u753b\u5e03\u3002",
    });
  }, [fitViewportToScene, runAutoLayout, serializeDocument, shapeNodeCount]);


  useEffect(() => {
    if (!isImportDialogOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      importTextareaRef.current?.focus();
      importTextareaRef.current?.select();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseImportDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCloseImportDialog, isImportDialogOpen]);

  useEffect(() => {
    if (!isDocumentImportDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseDocumentImportDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseDocumentImportDialog, isDocumentImportDialogOpen]);

  useEffect(() => {
    if (!isExportMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        exportMenuRef.current &&
        target instanceof globalThis.Node &&
        !exportMenuRef.current.contains(target)
      ) {
        setIsExportMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExportMenuOpen]);

  useEffect(() => {
    if (!isBackgroundMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        backgroundMenuRef.current &&
        target instanceof globalThis.Node &&
        !backgroundMenuRef.current.contains(target)
      ) {
        setIsBackgroundMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsBackgroundMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBackgroundMenuOpen]);

  const handleSave = useCallback(() => {
    const graphDocument = serializeDocument();
    persistToLocalStorage(graphDocument, {
      announce: "已保存到浏览器本地缓存。",
      syncImportText: true,
    });
  }, [persistToLocalStorage, serializeDocument]);

  const handleSaveToDatabase = useCallback(async () => {
    if (isSavingToDatabase) {
      return;
    }

    if (isCanvasEmpty) {
      setStatus("当前画布为空，暂不支持保存到数据库。");
      return;
    }

    const graphDocument = serializeDocument();
    persistToLocalStorage(graphDocument, {
      syncImportText: true,
    });

    setIsSavingToDatabase(true);

    try {
      const normalizedName = normalizeGraphFileName(currentFileNameRef.current);
      let taskId = activeWorkspaceFile?.taskId?.trim() ?? "";

      if (!taskId) {
        const task = await openApiClient.createDocumentTask({
          sourceType: "custom",
          title: normalizedName,
        });

        bindTaskToWorkspaceFile(activeFileIdRef.current, task.id, {
          title: task.title,
          switchToFile: true,
        });
        setTasks((current) => sortRecordsByCreatedAtDesc([task, ...current.filter((item) => item.id !== task.id)]));
        taskId = task.id;
      }

      const persistedResult = buildTaskResultFromGraphDocument(graphDocument, {
        graphId: BACKEND_GRAPH_ID,
        sourceType: "custom",
      });

      await openApiClient.saveTaskResult(taskId, { result: persistedResult });
      await openApiClient.applyTaskResult(taskId);
      setSelectedTaskId(taskId);
      await loadTaskList({ highlightTaskId: taskId, silent: true });
      setStatus(`保存成功：已将《${normalizedName}》关系图写入数据库。`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "保存到数据库失败，请稍后重试。");
    } finally {
      setIsSavingToDatabase(false);
    }
  }, [
    activeWorkspaceFile,
    bindTaskToWorkspaceFile,
    isCanvasEmpty,
    isSavingToDatabase,
    loadTaskList,
    persistToLocalStorage,
    serializeDocument,
  ]);

  const triggerFileDownload = useCallback((url: string, filename: string) => {
    if (typeof window === "undefined") {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const triggerBlobDownload = useCallback(
    (blob: Blob, filename: string) => {
      if (typeof window === "undefined") {
        return;
      }

      const url = URL.createObjectURL(blob);
      triggerFileDownload(url, filename);

      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    },
    [triggerFileDownload],
  );

  const requestExportSaveTarget = useCallback(async (request: ExportSaveRequest): Promise<ExportSaveTarget> => {
    if (typeof window === "undefined") {
      return {
        kind: "download",
        filename: request.filename,
      };
    }

    const browserWindow = window as WindowWithSaveFilePicker;
    if (!browserWindow.showSaveFilePicker) {
      return {
        kind: "download",
        filename: request.filename,
      };
    }

    try {
      const handle = await browserWindow.showSaveFilePicker({
        suggestedName: request.filename,
        excludeAcceptAllOption: false,
        types: [
          {
            description: request.description,
            accept: {
              [request.mimeType]: [request.extension],
            },
          },
        ],
      });

      return {
        kind: "picker",
        handle,
      };
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("已取消导出。");
      }

      return {
        kind: "download",
        filename: request.filename,
      };
    }
  }, []);

  const writeBlobToExportTarget = useCallback(
    async (blob: Blob, target: ExportSaveTarget) => {
      if (target.kind === "download") {
        triggerBlobDownload(blob, target.filename);
        return;
      }

      const writable = await target.handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    [triggerBlobDownload],
  );

  const buildCanvasExportCanvas = useCallback(async () => {
    if (typeof window === "undefined") {
      throw new Error("当前环境不支持导出。");
    }

    if (!flowInstance || !canvasRef.current) {
      throw new Error("画布尚未准备好，暂时无法导出。");
    }

    const viewportElement = canvasRef.current.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewportElement) {
      throw new Error("未找到可导出的画布视图。");
    }

    const waitForNextFrame = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

    const resolveExportBounds = () => {
      const exportNodes = flowInstance.getNodes().filter((node) => !node.hidden);
      if (exportNodes.length === 0) {
        throw new Error("当前画布为空，无法导出图片。");
      }

      const nextBounds = flowInstance.getNodesBounds(exportNodes);
      const hasValidBounds =
        Number.isFinite(nextBounds.x) &&
        Number.isFinite(nextBounds.y) &&
        Number.isFinite(nextBounds.width) &&
        Number.isFinite(nextBounds.height) &&
        nextBounds.width > 0 &&
        nextBounds.height > 0;

      return hasValidBounds ? nextBounds : null;
    };

    const renderCanvas = async (backgroundColor: string) => {
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }

      await waitForNextFrame();

      let bounds = resolveExportBounds();
      if (!bounds) {
        await waitForNextFrame();
        bounds = resolveExportBounds();
      }

      if (!bounds) {
        throw new Error("暂时无法计算导出范围，请稍后重试。");
      }

      const exportWidth = Math.max(Math.ceil(bounds.width + EXPORT_PADDING * 2), EXPORT_MIN_WIDTH);
      const exportHeight = Math.max(Math.ceil(bounds.height + EXPORT_PADDING * 2), EXPORT_MIN_HEIGHT);
      const exportViewport = getViewportForBounds(bounds, exportWidth, exportHeight, 0.15, 2.5, 0);
      const { toCanvas } = await import("html-to-image");
      const renderOptions = {
        backgroundColor,
        cacheBust: true,
        pixelRatio: 2,
        width: exportWidth,
        height: exportHeight,
        canvasWidth: exportWidth,
        canvasHeight: exportHeight,
        imagePlaceholder: EXPORT_IMAGE_PLACEHOLDER,
        style: {
          width: `${exportWidth}px`,
          height: `${exportHeight}px`,
          transform: `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
          transformOrigin: "0 0",
          fontFamily: GRAPH_CANVAS_FONT_FAMILY,
        },
      };

      const canvas = await (async () => {
        try {
          return await toCanvas(viewportElement, renderOptions);
        } catch (error) {
          if (!isHtmlToImageFontEmbedError(error)) {
            throw error;
          }

          console.warn("html-to-image 字体嵌入失败，正在回退为无字体嵌入模式。", error);
          return toCanvas(viewportElement, {
            ...renderOptions,
            skipFonts: true,
          });
        }
      })();

      if (!canvas) {
        throw new Error("导出画布生成失败。");
      }

      return {
        canvas,
        width: exportWidth,
        height: exportHeight,
        viewport: exportViewport,
      };
    };

    if (canvasBackgroundMode === "plain") {
      const { canvas, width, height } = await renderCanvas("#ffffff");
      return { canvas, width, height };
    }

    const exportResult = await renderCanvas("rgba(255, 255, 255, 0)");
    const outputCanvas = createExportBackgroundCanvas({
      width: exportResult.width,
      height: exportResult.height,
      pixelWidth: exportResult.canvas.width,
      pixelHeight: exportResult.canvas.height,
      mode: canvasBackgroundMode,
      viewport: exportResult.viewport,
    });
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) {
      throw new Error("无法创建导出画布上下文。");
    }

    outputContext.drawImage(exportResult.canvas, 0, 0, outputCanvas.width, outputCanvas.height);

    return {
      canvas: outputCanvas,
      width: exportResult.width,
      height: exportResult.height,
    };
  }, [canvasBackgroundMode, flowInstance]);

  const handleDownloadJson = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isCanvasEmpty) {
      setStatus("当前画布为空，无法导出。");
      return;
    }

    try {
      const graphDocument = serializeDocument();
      const blob = new Blob([JSON.stringify(graphDocument, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      triggerBlobDownload(blob, "icvn-graph.json");
      setImportText(stringifyGraphDocument(graphDocument));
      setStatus("已导出当前关系图 JSON。");
    } catch {
      setStatus("导出失败，请稍后重试。");
    }
  }, [isCanvasEmpty, serializeDocument, triggerBlobDownload]);

  const handleExportPng = useCallback(async () => {
    if (isCanvasEmpty) {
      setStatus("当前画布为空，无法导出。");
      return;
    }

    try {
      const saveTarget = await requestExportSaveTarget({
        filename: "icvn-graph.png",
        description: "PNG 图片",
        mimeType: "image/png",
        extension: ".png",
      });

      const { canvas } = await buildCanvasExportCanvas();
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((nextBlob) => resolve(nextBlob), "image/png");
      });

      if (!blob) {
        throw new Error("PNG 生成失败，请稍后重试。");
      }

      await writeBlobToExportTarget(blob, saveTarget);
      setStatus("已导出当前关系图 PNG 图片。");
    } catch (error: unknown) {
      console.error("PNG export failed", error);
      setStatus(error instanceof Error ? error.message : "导出 PNG 失败，请稍后重试。");
    }
  }, [buildCanvasExportCanvas, isCanvasEmpty, requestExportSaveTarget, writeBlobToExportTarget]);

  const handleExportPdf = useCallback(async () => {
    if (isCanvasEmpty) {
      setStatus("当前画布为空，无法导出。");
      return;
    }

    try {
      const saveTarget = await requestExportSaveTarget({
        filename: "icvn-graph.pdf",
        description: "PDF 文档",
        mimeType: "application/pdf",
        extension: ".pdf",
      });

      const { canvas, width, height } = await buildCanvasExportCanvas();
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: width >= height ? "landscape" : "portrait",
        unit: "px",
        format: [width, height],
        compress: true,
      });

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, height, undefined, "FAST");
      const pdfBlob = pdf.output("blob");
      await writeBlobToExportTarget(pdfBlob, saveTarget);
      setStatus("已导出当前关系图 PDF。");
    } catch (error: unknown) {
      console.error("PDF export failed", error);
      setStatus(error instanceof Error ? error.message : "导出 PDF 失败，请稍后重试。");
    }
  }, [buildCanvasExportCanvas, isCanvasEmpty, requestExportSaveTarget, writeBlobToExportTarget]);
  const handleLoadSample = useCallback(() => {
    applyDocument(createSampleGraphDocument(), "已重置为新的示例关系图。");
  }, [applyDocument]);

  const handleFitView = useCallback(async () => {
    const nextViewport = await fitViewportToScene();

    if (nextViewport) {
      setImportText(
        stringifyGraphDocument({
          ...serializeDocument(),
          viewport: nextViewport,
        }),
      );
      setStatus("\u5df2\u81ea\u52a8\u9002\u914d\u5f53\u524d\u89c6\u56fe\u3002");
    }
  }, [fitViewportToScene, serializeDocument]);

  const handleToolbarZoom = useCallback(
    (direction: "in" | "out") => {
      if (!flowInstance) {
        return;
      }

      const currentViewport = flowInstance.getViewport();
      const zoomStep = direction === "in" ? 1.18 : 1 / 1.18;
      const nextZoom = clamp(currentViewport.zoom * zoomStep, 0.15, 2.5);

      if (!canvasRef.current) {
        applyViewport({
          x: currentViewport.x,
          y: currentViewport.y,
          zoom: nextZoom,
        }, { duration: 160 });
        return;
      }

      const rect = canvasRef.current.getBoundingClientRect();
      const centerClientX = rect.left + rect.width / 2;
      const centerClientY = rect.top + rect.height / 2;
      const centerFlowPosition = flowInstance.screenToFlowPosition({
        x: centerClientX,
        y: centerClientY,
      });
      const nextViewport = {
        x: rect.width / 2 - centerFlowPosition.x * nextZoom,
        y: rect.height / 2 - centerFlowPosition.y * nextZoom,
        zoom: nextZoom,
      };

      applyViewport(nextViewport, { duration: 160 });
    },
    [applyViewport, flowInstance],
  );

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance<AppNode, AppEdge>) => {
      setFlowInstance(instance);
      void instance.setViewport(viewport);
    },
    [viewport],
  );

  const updateShapeNodeData = useCallback(
    (patch: Partial<ShapeNodeData>) => {
      if (!isShapeNode(selectedNode)) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id && node.type === "shapeNode"
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...patch,
                },
              }
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const updateEdge = useCallback(
    (updater: (edge: AppEdge) => AppEdge) => {
      const editableEdgeId = selectedEdgeId ?? selectedEdgeLabelId;

      if (!editableEdgeId) {
        return;
      }

      setEdges((currentEdges) =>
        currentEdges.map((edge) => (edge.id === editableEdgeId ? updater(edge) : edge)),
      );
    },
    [selectedEdgeId, selectedEdgeLabelId, setEdges],
  );

  const updateEdgeData = useCallback(
    (patch: Partial<RelationEdgeData>) => {
      updateEdge((edge) =>
        createRelationEdge({
          ...edge,
          id: edge.id,
          label: typeof edge.label === "string" ? edge.label : "",
          data: {
            ...edge.data,
            pathStyle: patch.pathStyle ?? edge.data?.pathStyle ?? defaultRelationEdgeData.pathStyle,
            dashed: patch.dashed ?? edge.data?.dashed ?? defaultRelationEdgeData.dashed,
            marker: patch.marker ?? edge.data?.marker ?? defaultRelationEdgeData.marker,
            color: patch.color ?? edge.data?.color ?? defaultRelationEdgeData.color,
            labelOffset: patch.labelOffset ?? edge.data?.labelOffset,
            labelAnchorPosition: patch.labelAnchorPosition ?? edge.data?.labelAnchorPosition,
            manualRoute: patch.manualRoute ?? edge.data?.manualRoute,
            manualRouteMode: patch.manualRouteMode ?? edge.data?.manualRouteMode,
            isEventEdge: patch.isEventEdge ?? edge.data?.isEventEdge,
            eventID: patch.eventID ?? edge.data?.eventID,
            eventOverview: patch.eventOverview ?? edge.data?.eventOverview,
            eventDescription: patch.eventDescription ?? edge.data?.eventDescription,
            eventName1: patch.eventName1 ?? edge.data?.eventName1,
            eventName2: patch.eventName2 ?? edge.data?.eventName2,
          },
        }),
      );
    },
    [updateEdge],
  );

  const updateSelectedEdgeLabel = useCallback(
    (label: string) => {
      updateEdge((edge) =>
        createRelationEdge({
          ...edge,
          id: edge.id,
          label,
          data: {
            pathStyle: edge.data?.pathStyle ?? defaultRelationEdgeData.pathStyle,
            dashed: edge.data?.dashed ?? defaultRelationEdgeData.dashed,
            marker: edge.data?.marker ?? defaultRelationEdgeData.marker,
            color: edge.data?.color ?? defaultRelationEdgeData.color,
            labelOffset: edge.data?.labelOffset,
            labelAnchorPosition: edge.data?.labelAnchorPosition,
            labelPlacementMode: edge.data?.labelPlacementMode,
            manualRoute: edge.data?.manualRoute,
            manualRouteMode: edge.data?.manualRouteMode,
            isEventEdge: edge.data?.isEventEdge,
            eventID: edge.data?.eventID,
            eventDescription: edge.data?.eventDescription,
            eventName1: edge.data?.eventName1,
            eventName2: edge.data?.eventName2,
            ...(edge.data?.isEventEdge
              ? {
                  eventOverview: label,
                }
              : {
                  eventOverview: edge.data?.eventOverview,
                }
            ),
          },
        }),
      );
    },
    [updateEdge],
  );

  const updateSelectedEventDescription = useCallback(
    (eventDescription: string) => {
      updateEdge((edge) =>
        createRelationEdge({
          ...edge,
          id: edge.id,
          label: typeof edge.label === "string" ? edge.label : "",
          data: {
            pathStyle: edge.data?.pathStyle ?? defaultRelationEdgeData.pathStyle,
            dashed: edge.data?.dashed ?? defaultRelationEdgeData.dashed,
            marker: edge.data?.marker ?? defaultRelationEdgeData.marker,
            color: edge.data?.color ?? defaultRelationEdgeData.color,
            labelOffset: edge.data?.labelOffset,
            labelAnchorPosition: edge.data?.labelAnchorPosition,
            labelPlacementMode: edge.data?.labelPlacementMode,
            manualRoute: edge.data?.manualRoute,
            manualRouteMode: edge.data?.manualRouteMode,
            isEventEdge: edge.data?.isEventEdge,
            eventID: edge.data?.eventID,
            eventOverview: edge.data?.eventOverview,
            eventDescription,
            eventName1: edge.data?.eventName1,
            eventName2: edge.data?.eventName2,
          },
        }),
      );
    },
    [updateEdge],
  );

  const handleOpenImagePicker = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleSelectNodeImage = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file || !isShapeNode(selectedNode)) {
        return;
      }

      try {
        const imageUrl = await readFileAsDataUrl(file);
        updateShapeNodeData({ imageUrl });
        setStatus("已更新图形图片。");
      } catch (error: unknown) {
        setStatus(error instanceof Error ? error.message : "图片导入失败，请重试。");
      }
    },
    [selectedNode, updateShapeNodeData],
  );

  const handleRemoveNodeImage = useCallback(() => {
    if (!isShapeNode(selectedNode)) {
      return;
    }

    updateShapeNodeData({ imageUrl: undefined });
    setStatus("已移除图形图片。");
  }, [selectedNode, updateShapeNodeData]);

  const handleToggleWorkspaceSidebar = useCallback(() => {
    setShowWorkspaceSidebar((current) => !current);
  }, []);

  const handleToggleExportMenu = useCallback(() => {
    if (isCanvasEmpty) {
      setStatus("当前画布为空，无法导出。");
      setIsExportMenuOpen(false);
      return;
    }

    setIsBackgroundMenuOpen(false);
    setIsExportMenuOpen((current) => !current);
  }, [isCanvasEmpty]);

  const handleToggleBackgroundMenu = useCallback(() => {
    setIsExportMenuOpen(false);
    setIsBackgroundMenuOpen((current) => !current);
  }, []);

  const handleChangeCanvasBackground = useCallback((mode: "grid" | "plain") => {
    setCanvasBackgroundMode(mode);
    setIsBackgroundMenuOpen(false);
  }, []);

  const handleExportAction = useCallback(
    (type: "json" | "png" | "pdf") => {
      if (isCanvasEmpty) {
        setIsExportMenuOpen(false);
        setStatus("当前画布为空，无法导出。");
        return;
      }

      setIsExportMenuOpen(false);

      if (type === "json") {
        handleDownloadJson();
        return;
      }

      if (type === "png") {
        void handleExportPng();
        return;
      }

      void handleExportPdf();
    },
    [handleDownloadJson, handleExportPdf, handleExportPng, isCanvasEmpty],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Escape" && (totalSelectionCount > 0 || Boolean(selectedEdgeLabelId))) {
        event.preventDefault();
        clearSelection();
        setStatus("已取消当前选择。");
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "a") {
        event.preventDefault();
        handleSelectAll();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "c" && selectedShapeNodes.length > 0) {
        event.preventDefault();
        handleCopySelectedNode();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "v") {
        event.preventDefault();
        handlePasteCopiedNode();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "d" && selectedShapeNodes.length > 0) {
        event.preventDefault();
        handleDuplicateSelectedNode();
        return;
      }

      if (isModifierPressed && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        handleToolbarZoom("in");
        return;
      }

      if (isModifierPressed && event.key === "-") {
        event.preventDefault();
        handleToolbarZoom("out");
        return;
      }

      if (isModifierPressed && event.key === "0") {
        event.preventDefault();
        void handleFitView();
        return;
      }

      if (selectedShapeNodes.length > 0 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        handleNudgeSelectedNode(
          event.key === "ArrowUp"
            ? "up"
            : event.key === "ArrowDown"
              ? "down"
              : event.key === "ArrowLeft"
                ? "left"
                : "right",
          event.shiftKey ? 16 : 4,
        );
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (
        (isModifierPressed && event.key.toLowerCase() === "y") ||
        (isModifierPressed && event.shiftKey && event.key.toLowerCase() === "z")
      ) {
        event.preventDefault();
        handleRedo();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && (totalSelectionCount > 0 || Boolean(selectedEdgeLabelId))) {
        event.preventDefault();
        handleDeleteCurrentSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearSelection,
    handleCopySelectedNode,
    handleDeleteCurrentSelection,
    handleDeleteSelection,
    handleDuplicateSelectedNode,
    handleFitView,
    handleNudgeSelectedNode,
    handlePasteCopiedNode,
    handleRedo,
    handleSave,
    handleSelectAll,
    handleToolbarZoom,
    handleUndo,
    selectedEdgeLabelId,
    selectedShapeNodes.length,
    totalSelectionCount,
  ]);

  return (
    <main className="flex h-screen flex-col bg-[#eef2f7] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-sky-600 text-sm font-semibold text-white">
              图
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={titleInputRef}
                  value={currentFileName}
                  onChange={(event) => setCurrentFileName(event.target.value)}
                  onBlur={() => {
                    const normalizedName = normalizeGraphFileName(currentFileName);
                    if (skipNextTitleBlurCommitRef.current === normalizedName) {
                      skipNextTitleBlurCommitRef.current = null;
                      return;
                    }

                    commitCurrentFileName(currentFileName);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const normalizedName = commitCurrentFileName(currentFileName, {
                        announce: `\u5df2\u66f4\u65b0\u6807\u9898\u4e3a\u300a${normalizeGraphFileName(currentFileName)}\u300b\u3002`,
                      });
                      skipNextTitleBlurCommitRef.current = normalizedName;
                      titleInputRef.current?.blur();
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setCurrentFileName(activeWorkspaceFile?.name ?? DEFAULT_FILE_NAME);
                      titleInputRef.current?.blur();
                    }
                  }}
                  className="h-8 min-w-[220px] max-w-[420px] rounded-xl border border-transparent bg-transparent px-2 text-sm font-semibold text-slate-900 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  aria-label="\u5f53\u524d\u6587\u4ef6\u6807\u9898"
                />
              </div>
              <p className="truncate text-xs text-slate-500">
                {`本地文件共 ${workspaceFiles.length} 个，当前文件包含 ${nodes.length} 个图形和 ${edges.length} 条连线`}
              </p>
            </div>
          </div>

        </div>

        <div className="flex min-h-14 flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-2">
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={handleRelayout}
            disabled={isImportingLayout || isCanvasEmpty}
          >
            <RefreshCcw className="size-4" />
            {"\u6574\u7406\u5e03\u5c40"}
          </Button>
          <div ref={backgroundMenuRef} className="relative">
            <Button
              type="button"
              variant="outline"
              className={cn(
                toolbarButtonClassName,
                isBackgroundMenuOpen ? "border-sky-200 bg-sky-50 text-sky-700" : undefined,
              )}
              onClick={handleToggleBackgroundMenu}
            >
              {"画布背景"}
              <ChevronDown className={cn("size-4 transition-transform", isBackgroundMenuOpen ? "rotate-180" : undefined)} />
            </Button>
            {isBackgroundMenuOpen ? (
              <div className="absolute left-0 top-full z-40 mt-2 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.35)]">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
                    canvasBackgroundMode === "plain"
                      ? "bg-sky-50 text-sky-700"
                      : "text-slate-700 hover:bg-slate-50",
                  )}
                  onClick={() => handleChangeCanvasBackground("plain")}
                >
                  {"纯白"}
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
                    canvasBackgroundMode === "grid"
                      ? "bg-sky-50 text-sky-700"
                      : "text-slate-700 hover:bg-slate-50",
                  )}
                  onClick={() => handleChangeCanvasBackground("grid")}
                >
                  {"方格"}
                </button>
              </div>
            ) : null}
          </div>

          <div ref={exportMenuRef} className="relative">
            <Button
              type="button"
              variant="outline"
              className={cn(
                toolbarButtonClassName,
                isExportMenuOpen ? "border-sky-200 bg-sky-50 text-sky-700" : undefined,
              )}
              onClick={handleToggleExportMenu}
              disabled={isCanvasEmpty}
            >
              <Download className="size-4" />
              {"\u5bfc\u51fa"}
              <ChevronDown className={cn("size-4 transition-transform", isExportMenuOpen ? "rotate-180" : undefined)} />
            </Button>
            {isExportMenuOpen ? (
              <div className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.35)]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  onClick={() => handleExportAction("json")}
                  disabled={isCanvasEmpty}
                >
                  <FileJson className="size-4" />
                  {"\u5bfc\u51fa JSON"}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  onClick={() => handleExportAction("png")}
                  disabled={isCanvasEmpty}
                >
                  <ImageIcon className="size-4" />
                  {"\u5bfc\u51fa PNG"}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  onClick={() => handleExportAction("pdf")}
                  disabled={isCanvasEmpty}
                >
                  <FileText className="size-4" />
                  {"\u5bfc\u51fa PDF"}
                </button>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={handleOpenJsonImportDialog}
            disabled={isImportingLayout}
          >
            <FileJson className="size-4" />
            {"JSON 导入"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={() => void handleSaveToDatabase()}
            disabled={isSavingToDatabase || isCanvasEmpty}
            title={isCanvasEmpty ? "空白画布暂不支持保存到数据库" : "保存当前关系图 JSON 到数据库"}
            aria-label="保存到数据库"
          >
            <Save className="size-4" />
            {isSavingToDatabase ? "保存中..." : "保存"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={handleUndo}
            disabled={!canUndo}
            title="撤回（Ctrl/Cmd + Z）"
            aria-label="撤回"
          >
            <Undo2 className="size-4" />
            {"撤回"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={handleRedo}
            disabled={!canRedo}
            title="重做（Ctrl/Cmd + Y / Shift + Ctrl/Cmd + Z）"
            aria-label="重做"
          >
            <Redo2 className="size-4" />
            {"重做"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={handleLoadSample}
          >
            <RefreshCcw className="size-4" />
            {"\u91cd\u7f6e"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn(
              toolbarButtonClassName,
              "text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700",
            )}
            onClick={handleClearCanvas}
            disabled={isCanvasEmpty}
          >
            <Eraser className="size-4" />
            {"\u6e05\u7a7a\u753b\u5e03"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={toolbarButtonClassName}
            onClick={handleDeleteCurrentSelection}
            disabled={totalSelectionCount === 0 && !selectedEdgeLabelOwner}
          >
            <Trash2 className="size-4" />
            {selectedEdgeLabelOwner ? "\u5220\u9664\u8bf4\u660e" : "\u5220\u9664\u9009\u4e2d"}
          </Button>
        </div>

      </header>

      {status ? (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[140] w-fit max-w-[calc(100vw-3rem)] -translate-x-1/2">
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)] backdrop-blur",
              getStatusTone(status) === "error"
                ? "border-rose-200 bg-rose-50/95 text-rose-700"
                : getStatusTone(status) === "success"
                  ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
                  : "border-sky-200 bg-white/95 text-slate-700",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                getStatusTone(status) === "error"
                  ? "bg-rose-100 text-rose-600"
                  : getStatusTone(status) === "success"
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-sky-100 text-sky-600",
              )}
            >
              {getStatusTone(status) === "error" ? <X className="size-3.5" /> : <Check className="size-3.5" />}
            </div>
            <div className="min-w-0 whitespace-nowrap leading-6">{status}</div>
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-current/70 transition hover:bg-black/5 hover:text-current"
              onClick={() => setStatus("")}
              aria-label="关闭提示"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-all duration-200",
            showWorkspaceSidebar ? "w-[300px]" : "w-[60px]",
          )}
        >
          {showWorkspaceSidebar ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">工作区</div>
                  <div className="mt-1 text-xs text-slate-500">任务列表</div>
                </div>
                <Tooltip content="收起工作区" placement="right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    onClick={handleToggleWorkspaceSidebar}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                </Tooltip>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
                <div className="px-3 pb-4">
                  <NewFileMenuButton
                    label="新建任务/导入文档解析"
                    buttonClassName="h-11 w-full justify-center rounded-2xl border-slate-200 bg-white text-slate-700 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] hover:bg-slate-50"
                    onCreateCanvas={handleCreateCanvas}
                    onImportDocument={handleOpenDocumentImportDialog}
                  />
                </div>
                <div className={cn(isTaskListCollapsed ? "shrink-0" : "min-h-0")}>
                  <div className="flex items-center gap-1 px-1">
                    <div className="min-w-0 flex-1 text-left text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                      任务列表（{tasks.length}）
                    </div>
                    <Tooltip content={selectedTaskId ? "重命名当前任务" : "请先选中任务"} placement="bottom">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        onClick={() => void handleRenameSelectedTask()}
                        disabled={!selectedTaskId}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="刷新任务" placement="bottom">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        onClick={() => void loadTaskList()}
                      >
                        <RefreshCcw className={cn("size-4", isTaskListLoading ? "animate-spin" : undefined)} />
                      </Button>
                    </Tooltip>
                    <button
                      type="button"
                      aria-expanded={!isTaskListCollapsed}
                      aria-label={isTaskListCollapsed ? "展开任务列表" : "收起任务列表"}
                      className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                      onClick={() => setIsTaskListCollapsed((current) => !current)}
                    >
                      {isTaskListCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                  </div>
                  {!isTaskListCollapsed ? (
                    <div className="pt-3">
                      <TaskList
                        tasks={tasks}
                        selectedTaskId={selectedTaskId}
                        loadingTaskId={loadingTaskId}
                        isLoading={isTaskListLoading}
                        error={taskListError}
                        onSelectTask={(taskId) => void handleLoadTaskToCanvas(taskId)}
                        onDeleteTask={(task) => void handleDeleteTask(task)}
                        deletingTaskId={deletingTaskId}
                        onRefresh={() => void loadTaskList()}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center gap-2 px-2 py-3">
              <Tooltip content="展开工作区" placement="right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  onClick={handleToggleWorkspaceSidebar}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </Tooltip>
              <NewFileMenuButton
                align="left"
                iconOnly
                buttonClassName="size-10 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                onCreateCanvas={handleCreateCanvas}
                onImportDocument={handleOpenDocumentImportDialog}
              />
              <div className="mt-2 h-px w-8 bg-slate-200" />
              <div className="rounded-xl bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                {tasks.length}
              </div>
            </div>
          )}
        </aside>

        <section
          ref={canvasRef}
          className={cn(
            "relative min-w-0 flex-1",
            canvasBackgroundMode === "grid" ? "bg-[#f8fafc]" : "bg-white",
            isCanvasPanning ? "cursor-grabbing" : "cursor-grab",
          )}
          style={{ fontFamily: GRAPH_CANVAS_FONT_FAMILY }}
          onWheelCapture={handleCanvasWheel}
          onPointerDownCapture={handleCanvasPointerDown}
        >
          {isCanvasEmpty ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="max-w-md rounded-[28px] border border-slate-200/90 bg-white/92 px-6 py-5 text-center shadow-[0_26px_90px_-40px_rgba(15,23,42,0.35)] backdrop-blur">
                <div className="text-base font-semibold text-slate-900">{"\u753b\u5e03\u5f53\u524d\u4e3a\u7a7a"}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {"\u4f7f\u7528\u9876\u90e8\u5de5\u5177\u680f\u6dfb\u52a0\u77e9\u5f62\u3001\u5706\u89d2\u77e9\u5f62\u3001\u692d\u5706\u6216\u83f1\u5f62\uff1b\u4ece\u56fe\u5f62\u56db\u5411\u8fde\u63a5\u70b9\u62d6\u51fa\u8fde\u7ebf\uff0c\u53cc\u51fb\u5373\u53ef\u7f16\u8f91\u6587\u5b57\u4e0e\u8bf4\u660e\u3002"}
                </p>
              </div>
            </div>
          ) : null}
          {loadingTaskId ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/72 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)]">
                <RefreshCcw className="size-4 animate-spin text-sky-600" />
                <div>
                  <div className="font-medium text-slate-900">正在加载关系图</div>
                  <div className="text-xs text-slate-500">{loadingTask ? `任务：${loadingTask.title}` : "请稍候..."}</div>
                </div>
              </div>
            </div>
          ) : null}
          <ReactFlow<AppNode, AppEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={handleFlowInit}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onReconnect={handleReconnect}
            onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
            onSelectionChange={handleSelectionChange}
            onPaneClick={clearSelection}
            fitView
            minZoom={0.15}
            maxZoom={2.5}
            connectionMode={ConnectionMode.Loose}
            selectionMode={SelectionMode.Partial}
            defaultViewport={defaultViewport}
            deleteKeyCode={null}
            selectionOnDrag={false}
            panOnDrag={false}
            elevateEdgesOnSelect
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            panActivationKeyCode={null}
            zoomActivationKeyCode={null}
            autoPanOnNodeDrag
            autoPanOnConnect
            connectionRadius={32}
            nodeDragThreshold={1}
            connectionDragThreshold={1}
            preventScrolling
            edgesReconnectable
            reconnectRadius={36}
            connectionLineStyle={{ stroke: "#2563eb", strokeWidth: 2.25 }}
            className="bg-transparent"
          >
            {canvasBackgroundMode === "grid" ? (
              <Background
                color="rgba(148, 163, 184, 0.2)"
                gap={24}
                variant={BackgroundVariant.Lines}
              />
            ) : null}
            {isClientReady ? (
              <MiniMap
                pannable
                zoomable
                nodeColor={() => "#cbd5e1"}
                maskColor="rgba(148,163,184,0.08)"
                className="!bg-white/90"
              />
            ) : null}
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>

        {showRightSidebar ? (
          <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">右侧边栏</div>
                <div className="mt-1 text-xs text-slate-500">图形库与属性面板</div>
              </div>
              <Tooltip content="收起右侧边栏" placement="left">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setShowRightSidebar(false)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </Tooltip>
            </div>
            <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.28)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">图形库</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">点击添加图形到画布</p>
                </div>
                <button
                  type="button"
                  aria-expanded={!isRightShapeLibraryCollapsed}
                  aria-label={isRightShapeLibraryCollapsed ? "展开右侧图形库" : "收起右侧图形库"}
                  className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                  onClick={() => setIsRightShapeLibraryCollapsed((current) => !current)}
                >
                  {isRightShapeLibraryCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
              </div>
              {!isRightShapeLibraryCollapsed ? (
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {shapeOptions.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      aria-label={`添加${item.label}`}
                      className="flex h-12 items-center justify-center rounded-2xl border border-transparent bg-white/80 text-slate-600 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)] transition hover:bg-white hover:text-sky-700 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                      onClick={() => handleAddShape(item.kind)}
                    >
                      <ShapePreview kind={item.kind} />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
            {isMultiSelection ? (
              <SectionCard title="批量操作" description="多选时提供统一的删除与复制能力。">
                <div
                  className={cn(
                    "grid gap-2",
                    selectedShapeNodes.length > 0 ? "grid-cols-3" : "grid-cols-2",
                  )}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={handleCopySelectedNode}
                    disabled={!selectedShapeNodes.length}
                  >
                    {"\u590d\u5236\u56fe\u5f62"}
                  </Button>
                  {selectedShapeNodes.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={handleDuplicateSelectedNode}
                    >
                      {"\u751f\u6210\u526f\u672c"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    onClick={handleDeleteSelection}
                  >
                    <Trash2 className="size-4" />
                    {"\u6279\u91cf\u5220\u9664"}
                  </Button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  {selectedShapeNodes.length > 0
                    ? `当前多选中包含 ${selectedShapeNodes.length} 个图形，可复制或生成副本，Delete 仍可一次删除全部选中项。`
                    : "当前多选中仅包含连线，可直接使用 Delete 一次删除全部选中项。"}
                </p>
              </SectionCard>
            ) : selectedShapeNode ? (
              <>
                <SectionCard title="内容与图形" description="这里集中处理图形文本、形状和当前结构信息。">
                  <div className="space-y-4">
                    <Field label="图形文字">
                      <textarea
                        className={cn(inputClassName, "min-h-32 resize-none font-mono text-xs leading-6")}
                        value={selectedShapeNode.data.text}
                        onChange={(event) => updateShapeNodeData({ text: event.target.value })}
                      />
                    </Field>

                    <Field label="图形类型">
                      <div className="grid grid-cols-2 gap-2">
                        {shapeOptions.map((option) => (
                          <button
                            key={option.kind}
                            type="button"
                            className={cn(
                              segmentButtonClassName,
                              selectedShapeNode.data.kind === option.kind
                                ? "border-sky-300 bg-sky-50 text-sky-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                            onClick={() => updateShapeNodeData({ kind: option.kind })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard title="图片与操作" description="节点支持插图，也保留删除入口。">
                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start gap-3">
                        <div className="relative flex size-20 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                          {selectedShapeNode.data.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={selectedShapeNode.data.imageUrl}
                              alt={selectedShapeNode.data.text || "\u56fe\u5f62\u56fe\u7247"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                              {"\u6682\u65e0\u56fe\u7247"}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                            onClick={handleOpenImagePicker}
                          >
                            {selectedShapeNode.data.imageUrl ? "\u66f4\u6362\u56fe\u7247" : "\u4e0a\u4f20\u56fe\u7247"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                            onClick={handleRemoveNodeImage}
                            disabled={!selectedShapeNode.data.imageUrl}
                          >
                            {"\u79fb\u9664\u56fe\u7247"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                      onClick={() => handleDeleteNode(selectedShapeNode.id)}
                    >
                      <Trash2 className="size-4" />
                      {"\u5220\u9664\u56fe\u5f62"}
                    </Button>
                  </div>
                </SectionCard>
              </>
            ) : selectedEventInspectorEdge ? (
              <>
                <SectionCard title="事件详情" description="事件不再显示为节点框，完整信息集中展示在这里。">
                  <div className="space-y-4">
                    <Field label="事件概述">
                      <input
                        className={inputClassName}
                        value={typeof selectedEventInspectorEdge.label === "string" ? selectedEventInspectorEdge.label : ""}
                        placeholder="输入事件概述"
                        onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
                      />
                    </Field>

                    <Field label="完整描述">
                      <textarea
                        className={cn(inputClassName, "min-h-40 resize-none text-sm leading-6")}
                        value={selectedEventInspectorEdge.data?.eventDescription ?? ""}
                        placeholder="输入事件的详细描述"
                        onChange={(event) => updateSelectedEventDescription(event.target.value)}
                      />
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard title="连线样式" description="事件显示在线中间，连线仍可按现有方式调整路径。">
                  <div className="space-y-4">
                    <Field label="连线形态">
                      <div className="grid grid-cols-3 gap-2">
                        {pathStyleOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              segmentButtonClassName,
                              selectedEdgeData.pathStyle === option.value
                                ? "border-sky-300 bg-sky-50 text-sky-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                            onClick={() => updateEdgeData({ pathStyle: option.value })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <button
                      type="button"
                      className={cn(
                        segmentButtonClassName,
                        "flex w-full",
                        selectedEdgeData.dashed
                          ? "border-sky-300 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                      onClick={() => updateEdgeData({ dashed: !selectedEdgeData.dashed })}
                    >
                      {selectedEdgeData.dashed ? "当前为虚线，点击切换为实线" : "当前为实线，点击切换为虚线"}
                    </button>
                    <Field label="箭头样式">
                      <div className="grid grid-cols-2 gap-2">
                        {markerOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              segmentButtonClassName,
                              selectedEdgeData.marker === option.value
                                ? "border-sky-300 bg-sky-50 text-sky-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                            onClick={() => updateEdgeData({ marker: option.value })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard title="快捷操作" description="这里删除的是整条事件连线，不会回退成事件节点。">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={() => updateSelectedEdgeLabel("")}
                      disabled={!selectedEventInspectorEdge.label}
                    >
                      {"\u5220\u9664\u8bf4\u660e"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                      onClick={() => handleDeleteEdge(selectedEventInspectorEdge.id)}
                    >
                      <Trash2 className="size-4" />
                      {"\u5220\u9664\u8fde\u7ebf"}
                    </Button>
                  </div>
                </SectionCard>
              </>
            ) : selectedEdgeLabelOwner ? (
              <>
                <SectionCard title="说明内容" description="这里仅编辑当前说明标签，不影响连线形态与箭头。">
                  <div className="space-y-4">
                    <Field label="说明字段">
                      <input
                        className={inputClassName}
                        value={selectedEdgeLabelText}
                        placeholder="输入这条连线的说明"
                        onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
                      />
                    </Field>

                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                      {"\u4f60\u5f53\u524d\u7f16\u8f91\u7684\u662f\u8bf4\u660e\u6807\u7b7e\u672c\u8eab\uff0c\u56e0\u6b64 Delete \u53ea\u4f1a\u6e05\u7a7a\u8bf4\u660e\u6587\u5b57\uff1b\u5982\u9700\u5220\u9664\u6574\u6761\u8fde\u7ebf\uff0c\u8bf7\u5148\u70b9\u51fb\u8fde\u7ebf\u8def\u5f84\u672c\u4f53\u3002"}
                    </div>
                  </div>
                </SectionCard>
                <SectionCard title="标签操作" description="说明与连线本体的删除行为已分离。">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    onClick={() => handleDeleteEdgeLabel(selectedEdgeLabelOwner.id)}
                    disabled={!selectedEdgeLabelText}
                  >
                    <Trash2 className="size-4" />
                    {"\u5220\u9664\u8bf4\u660e"}
                  </Button>
                </SectionCard>
              </>
            ) : selectedEdge ? (
              <>
                <SectionCard title="说明与路径" description="说明字段与线路类型统一放在这里，便于快速编辑。">
                  <div className="space-y-4">
                    <Field label="说明字段">
                      <input
                        className={inputClassName}
                        value={selectedEdgeLabel}
                        placeholder="输入这条连线的说明"
                        onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
                      />
                    </Field>

                    <Field label="连线形态">
                      <div className="grid grid-cols-3 gap-2">
                        {pathStyleOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              segmentButtonClassName,
                              selectedEdgeData.pathStyle === option.value
                                ? "border-sky-300 bg-sky-50 text-sky-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                            onClick={() => updateEdgeData({ pathStyle: option.value })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <button
                      type="button"
                      className={cn(
                        segmentButtonClassName,
                        "flex w-full",
                        selectedEdgeData.dashed
                          ? "border-sky-300 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                      onClick={() => updateEdgeData({ dashed: !selectedEdgeData.dashed })}
                    >
                      {selectedEdgeData.dashed ? "当前为虚线，点击切换为实线" : "当前为实线，点击切换为虚线"}
                    </button>
                  </div>
                </SectionCard>

                <SectionCard title="箭头设置" description="连线终点样式会实时刷新到画布。">
                  <div className="space-y-4">
                    <Field label="箭头样式">
                      <div className="grid grid-cols-2 gap-2">
                        {markerOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              segmentButtonClassName,
                              selectedEdgeData.marker === option.value
                                ? "border-sky-300 bg-sky-50 text-sky-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                            onClick={() => updateEdgeData({ marker: option.value })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </div>
                </SectionCard>
                <SectionCard title="快捷操作" description="对说明文字和整条连线分别保留独立删除入口。">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={() => updateSelectedEdgeLabel("")}
                      disabled={!selectedEdgeLabel}
                    >
                      {"\u5220\u9664\u8bf4\u660e"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                      onClick={() => handleDeleteEdge(selectedEdge.id)}
                    >
                      <Trash2 className="size-4" />
                      {"\u5220\u9664\u8fde\u7ebf"}
                    </Button>
                  </div>
                </SectionCard>
              </>
            ) : (
              <SectionCard title="属性面板" description="选中图形或连线后，这里会显示可编辑配置。">
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm leading-6 text-slate-500">
                  当前未选中对象。右侧保留图形库，选中画布元素后会在这里显示对应设置。
                </div>
              </SectionCard>
            )}

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleSelectNodeImage}
            />
          </aside>
        ) : (
          <aside className="flex w-[60px] shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white px-2 py-3">
            <Tooltip content="展开右侧边栏" placement="left">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setShowRightSidebar(true)}
              >
                <ChevronLeft className="size-4" />
              </Button>
            </Tooltip>
          </aside>
        )}
      </div>

      {isFileDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"
          onClick={handleCloseFileDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="文件管理"
            className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_120px_-36px_rgba(15,23,42,0.38)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">文件管理</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    当前仅保存在浏览器本地，可在这里查看、切换、重命名或删除文件。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <NewFileMenuButton
                    label="新建任务/导入文档解析"
                    buttonClassName="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onCreateCanvas={handleCreateFile}
                    onImportDocument={handleOpenDocumentImportFromFileDialog}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={handleCloseFileDialog}
                  >
                    <X className="size-4" />
                    关闭
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden px-6 py-5 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col rounded-[28px] border border-slate-200 bg-slate-50/70">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                  {`文件列表（${workspaceFiles.length}）`}
                </div>
                <WorkspaceFileList
                  files={workspaceFiles}
                  activeFileId={activeFileId}
                  selectedFileId={selectedWorkspaceFileId}
                  renamingFileId={renamingFileId}
                  renameDraft={renameDraft}
                  autoFocusRename
                  className="flex-1 overflow-y-auto p-3"
                  onSelectFile={handleSelectWorkspaceFile}
                  onRenameDraftChange={setRenameDraft}
                  onCancelRename={(fallbackName) => {
                    setRenamingFileId(null);
                    setRenameDraft(fallbackName);
                  }}
                  onCommitRenameFile={handleCommitRenameWorkspaceFile}
                  onStartRenameFile={handleStartRenameWorkspaceFile}
                  onSwitchFile={handleSwitchFile}
                  onDeleteFile={handleDeleteWorkspaceFile}
                />
              </div>

              <div className="flex min-h-0 flex-col rounded-[28px] border border-slate-200 bg-slate-50/70 p-4">
                {selectedWorkspaceFile ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{selectedWorkspaceFile.name}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {`创建于 ${formatWorkspaceTime(selectedWorkspaceFile.createdAt)}，最近更新于 ${formatWorkspaceTime(selectedWorkspaceFile.updatedAt)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedWorkspaceFile.id === activeFileId ? (
                          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                            {"\u5f53\u524d\u6587\u4ef6"}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                          onClick={handleSaveWorkspaceFilePreview}
                          disabled={!isSelectedWorkspaceFilePreviewDirty}
                        >
                          <Save className="size-4" />
                          {"\u4fdd\u5b58 JSON"}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 flex min-h-0 flex-1 flex-col">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-slate-700">{"JSON \u5185\u5bb9"}</div>
                        <div className="text-xs text-slate-400">{"Ctrl/Cmd + S \u4fdd\u5b58\u4fee\u6539"}</div>
                      </div>
                      <textarea
                        value={selectedWorkspaceFilePreviewDraft}
                        onChange={(event) => setSelectedWorkspaceFilePreviewDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                            event.preventDefault();
                            handleSaveWorkspaceFilePreview();
                          }
                        }}
                        spellCheck={false}
                        className="min-h-[320px] flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-4 font-mono text-xs leading-6 text-slate-600 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isDocumentImportDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"
          onClick={handleCloseDocumentImportDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={"新建任务/导入文档解析"}
            className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_120px_-36px_rgba(15,23,42,0.38)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{"新建任务/导入文档解析"}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {"通过上传文档或输入文本来创建新任务，支持批量处理、AI 解析和结果入图。"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={handleCloseDocumentImportDialog}
                    disabled={isDocumentProcessing}
                  >
                    <X className="size-4" />
                    {"关闭"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5">
              <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
                <input
                  ref={documentImportInputRef}
                  type="file"
                  multiple
                  accept=".doc,.docx,.txt,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={handleDocumentFileInputChange}
                />

                <div
                  className={cn(
                    "rounded-[28px] border-2 border-dashed px-6 py-6 transition",
                    isDocumentDragActive
                      ? "border-sky-400 bg-sky-50/80"
                      : "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50/40",
                  )}
                  onDragOver={handleDocumentDragOver}
                  onDragLeave={handleDocumentDragLeave}
                  onDrop={handleDocumentDrop}
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex size-14 shrink-0 items-center justify-center rounded-[20px] bg-white text-sky-600 shadow-sm ring-1 ring-slate-200">
                        <Upload className="size-6" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{"拖拽文档到这里，或从本地批量选择"}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {"当前支持上传 .doc、.docx、.txt 文件。"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        onClick={handleTriggerDocumentUpload}
                        disabled={isDocumentProcessing}
                      >
                        <Upload className="size-4" />
                        {"添加文档"}
                      </Button>
                      <Button
                        type="button"
                        className="bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-300"
                        onClick={() => void handleStartDocumentProcessing()}
                        disabled={!canStartDocumentProcessing || isDocumentProcessing}
                      >
                        <RefreshCcw className={cn("size-4", isDocumentProcessing ? "animate-spin" : undefined)} />
                        {isDocumentProcessing ? "处理中..." : "开始处理"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{"处理队列"}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {"当前先提供上传队列、批量进度与状态反馈 UI；真正的清洗与抽取接口可在此基础上继续接入。"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={handleClearCompletedDocumentImports}
                    disabled={!hasCompletedDocumentImports || isDocumentProcessing}
                  >
                    <Check className="size-4" />
                    {"清理已完成"}
                  </Button>
                </div>

                {documentImportItems.length > 0 ? (
                  <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
                    {documentImportItems.map((item) => {
                      const statusMeta = getDocumentImportStatusMeta(item.status);

                      return (
                        <div
                          key={item.id}
                          className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-3">
                                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                                  <FileText className="size-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {formatFileSize(item.size)}
                                    {item.type ? ` · ${item.type}` : " · 未识别类型"}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4">
                                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                                  <span className={cn("rounded-full px-2.5 py-1 font-medium", statusMeta.badgeClassName)}>
                                    {statusMeta.label}
                                  </span>
                                  <span className="font-medium text-slate-500">{item.progress}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={cn("h-full rounded-full transition-all duration-300", statusMeta.progressClassName)}
                                    style={{ width: `${item.progress}%` }}
                                  />
                                </div>
                                <p className="mt-2 text-xs leading-5 text-slate-500">{item.message}</p>
                              </div>
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              className="border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                              onClick={() => handleRemoveDocumentImportItem(item.id)}
                              disabled={isDocumentProcessing && (item.status === "uploading" || item.status === "processing")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-[280px] flex-1 items-center justify-center rounded-[28px] border border-slate-200 bg-slate-50/70 px-6 py-10 text-center">
                    <div className="max-w-md">
                      <div className="mx-auto flex size-14 items-center justify-center rounded-[20px] bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
                        <Files className="size-6" />
                      </div>
                      <div className="mt-4 text-base font-semibold text-slate-900">{"还没有待处理文档"}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {"先批量加入原始资料，再通过处理按钮触发上传与清洗流程；后续可直接将后端结果接回关系图导入。"}
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      ) : null}

      {isImportDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"
          onClick={handleCloseImportDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="JSON 导入"
            className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_120px_-36px_rgba(15,23,42,0.38)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">导入 JSON</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    粘贴 `Last_output.json` 这类 AI 返回结果，或直接粘贴关系图 JSON，确认后自动导入并整理布局。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={handleCloseImportDialog}
                  disabled={isImportingLayout || isSavingToDatabase}
                >
                  取消
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
              <textarea
                ref={importTextareaRef}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleImport();
                  }
                }}
                className="min-h-[360px] w-full flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 font-mono text-xs leading-6 text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                spellCheck={false}
                placeholder="在这里粘贴需要导入的 JSON 内容"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs leading-5 text-slate-400">
                  {"\u652f\u6301 `nodes + edges`\u3001`data.nodes + data.edges` \u4ee5\u53ca\u4efb\u52a1\u7ed3\u679c\u7ed3\u6784\uff1b\u7a7a\u7684 `nodes/edges` \u753b\u5e03\u4e0d\u4f1a\u5bfc\u5165\uff1b\u5feb\u6377\u952e `Ctrl/Cmd + Enter` \u53ef\u76f4\u63a5\u5bfc\u5165\u3002"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    className="bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-300"
                    onClick={() => void handleImport()}
                    disabled={isImportingLayout || isSavingToDatabase}
                  >
                    <Upload className="size-4" />
                    {isImportingLayout ? "导入中..." : isSavingToDatabase ? "保存中..." : "导入并布局"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
