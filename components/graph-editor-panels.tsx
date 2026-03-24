"use client";

import {
  Check,
  ChevronDown,
  FileJson,
  Files,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ShapeNodeKind } from "./graph/sample-graph";

export type WorkspaceFileLike = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  document: {
    nodes: unknown[];
    edges: unknown[];
  };
};

export function formatWorkspaceTime(timestamp: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return timestamp;
  }
}

export function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function SectionCard({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.28)]">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

type NewFileMenuButtonProps = {
  align?: "left" | "right";
  buttonClassName?: string;
  iconOnly?: boolean;
  onCreateCanvas: () => void;
  onImportDocument: () => void;
};

export function NewFileMenuButton({
  align = "right",
  buttonClassName,
  iconOnly = false,
  onCreateCanvas,
  onImportDocument,
}: NewFileMenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number }>({ left: 12, top: 12 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPosition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const menuWidth = 192;
    const viewportWidth = window.innerWidth;
    const preferredLeft = align === "left" ? rect.left : rect.right - menuWidth;
    const nextLeft = Math.min(Math.max(12, preferredLeft), Math.max(12, viewportWidth - menuWidth - 12));

    setMenuStyle({
      left: nextLeft,
      top: rect.bottom + 8,
    });
  }, [align]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof globalThis.Node &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleViewportChange = () => updateMenuPosition();

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updateMenuPosition]);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={iconOnly ? "ghost" : "outline"}
        size={iconOnly ? "icon" : "default"}
        className={cn(buttonClassName, !iconOnly ? "gap-2" : undefined)}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Plus className="size-4" />
        {!iconOnly ? (
          <>
            新建文件
            <ChevronDown className={cn("size-4 transition-transform", isOpen ? "rotate-180" : undefined)} />
          </>
        ) : null}
      </Button>

      {isOpen ? (
        <div
          ref={menuRef}
          className="fixed z-[80] w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.35)]"
          style={menuStyle}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => {
              setIsOpen(false);
              onCreateCanvas();
            }}
          >
            <Plus className="size-4" />
            新建画布
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => {
              setIsOpen(false);
              onImportDocument();
            }}
          >
            <Upload className="size-4" />
            导入文档
          </button>
        </div>
      ) : null}
    </>
  );
}

export type WorkspaceFileListProps = {
  files: WorkspaceFileLike[];
  activeFileId: string;
  selectedFileId: string;
  renamingFileId: string | null;
  renameDraft: string;
  compact?: boolean;
  autoFocusRename?: boolean;
  variant?: "cards" | "explorer";
  className?: string;
  onSelectFile: (fileId: string) => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: (fallbackName: string) => void;
  onCommitRenameFile: () => void;
  onStartRenameFile: (fileId: string) => void;
  onSwitchFile: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onEditJson?: (fileId: string) => void;
};

export function WorkspaceFileList({
  files,
  activeFileId,
  selectedFileId,
  renamingFileId,
  renameDraft,
  compact = false,
  autoFocusRename = false,
  variant = "cards",
  className,
  onSelectFile,
  onRenameDraftChange,
  onCancelRename,
  onCommitRenameFile,
  onStartRenameFile,
  onSwitchFile,
  onDeleteFile,
  onEditJson,
}: WorkspaceFileListProps) {
  const [openActionMenuFileId, setOpenActionMenuFileId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openActionMenuFileId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof globalThis.Node && actionMenuRef.current?.contains(target)) {
        return;
      }

      setOpenActionMenuFileId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenActionMenuFileId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openActionMenuFileId]);

  if (files.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[160px] items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-white/80 p-6 text-center text-sm leading-6 text-slate-500",
          className,
        )}
      >
        当前工作区还没有文件，先新建一个文件开始绘制吧。
      </div>
    );
  }

  return (
    <div className={cn(variant === "explorer" ? "space-y-1" : "space-y-3", className)}>
      {files.map((file) => {
        const isSelected = file.id === selectedFileId;
        const isActive = file.id === activeFileId;
        const isRenaming = file.id === renamingFileId;
        const useExplorerVariant = variant === "explorer";

        if (useExplorerVariant) {
          return (
            <div
              key={file.id}
              className={cn(
                "group relative flex items-center gap-2 rounded-xl border px-2 py-2 transition",
                isActive
                  ? "border-sky-300 bg-sky-50 text-sky-700"
                  : isSelected
                    ? "border-slate-300 bg-slate-50 text-slate-700"
                    : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => {
                  onSelectFile(file.id);
                  if (!isActive) {
                    onSwitchFile(file.id);
                  }
                }}
              >
                <Files className="size-4 shrink-0" />

                {isRenaming ? (
                  <input
                    value={renameDraft}
                    onChange={(event) => onRenameDraftChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitRenameFile();
                      }

                      if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelRename(file.name);
                      }
                    }}
                    onClick={(event) => event.stopPropagation()}
                    className="h-8 w-full rounded-lg border border-sky-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300"
                    autoFocus={autoFocusRename}
                  />
                ) : (
                  <>
                    <span className="truncate text-sm font-medium">{file.name}</span>
                    {isActive ? <span className="size-2 shrink-0 rounded-full bg-sky-500" /> : null}
                  </>
                )}
              </button>

              <div className="flex shrink-0 items-center gap-1">
                {isRenaming ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-sky-700 hover:bg-sky-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCommitRenameFile();
                    }}
                  >
                    <Check className="size-4" />
                  </Button>
                ) : (
                  <div
                    ref={openActionMenuFileId === file.id ? actionMenuRef : null}
                    className="relative"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenActionMenuFileId((current) => (current === file.id ? null : file.id));
                      }}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>

                    {openActionMenuFileId === file.id ? (
                      <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.35)]">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenActionMenuFileId(null);
                            onSelectFile(file.id);
                            onStartRenameFile(file.id);
                          }}
                        >
                          <Pencil className="size-4" />
                          重命名
                        </button>
                        {onEditJson ? (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenActionMenuFileId(null);
                              onSelectFile(file.id);
                              onEditJson(file.id);
                            }}
                          >
                            <FileJson className="size-4" />
                            编辑 JSON
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenActionMenuFileId(null);
                            onDeleteFile(file.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            key={file.id}
            className={cn(
              "rounded-[24px] border bg-white transition",
              compact ? "p-3" : "p-3",
              isSelected
                ? "border-sky-300 shadow-[0_12px_40px_-28px_rgba(2,132,199,0.38)]"
                : "border-slate-200 hover:border-slate-300",
            )}
            onClick={() => onSelectFile(file.id)}
            onDoubleClick={() => {
              if (!isActive) {
                onSwitchFile(file.id);
              }
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                  isActive ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500",
                )}
              >
                <Files className="size-4" />
              </div>

              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={renameDraft}
                      onChange={(event) => onRenameDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onCommitRenameFile();
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          onCancelRename(file.name);
                        }
                      }}
                      className="h-9 w-full rounded-xl border border-sky-200 bg-sky-50 px-3 text-sm text-slate-900 outline-none ring-0 focus:border-sky-300 focus:bg-white"
                      autoFocus={autoFocusRename}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size={compact ? "sm" : "default"}
                      className="border-sky-200 bg-white px-3 text-sky-700 hover:bg-sky-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCommitRenameFile();
                      }}
                    >
                      <Check className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-semibold text-slate-900">{file.name}</div>
                    {isActive ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                        当前
                      </span>
                    ) : null}
                    {isSelected && !isActive ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        已选中
                      </span>
                    ) : null}
                  </div>
                )}

                <div className="mt-1 text-xs text-slate-500">更新于 {formatWorkspaceTime(file.updatedAt)}</div>
                {!compact ? (
                  <div className="mt-1 text-xs text-slate-400">
                    {`${file.document.nodes.length} 个图形 · ${file.document.edges.length} 条连线`}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={cn("flex flex-wrap items-center gap-2", compact ? "mt-2" : "mt-3")}>
              {!isActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size={compact ? "sm" : "default"}
                  className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSwitchFile(file.id);
                  }}
                >
                  <Files className="size-4" />
                  切换
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size={compact ? "sm" : "default"}
                className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartRenameFile(file.id);
                }}
              >
                <Pencil className="size-4" />
                重命名
              </Button>

              {onEditJson ? (
                <Button
                  type="button"
                  variant="outline"
                  size={compact ? "sm" : "default"}
                  className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectFile(file.id);
                    onEditJson(file.id);
                  }}
                >
                  <FileJson className="size-4" />
                  编辑 JSON
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size={compact ? "sm" : "default"}
                className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteFile(file.id);
                }}
              >
                <Trash2 className="size-4" />
                删除
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ShapePreview({ kind }: { kind: ShapeNodeKind }) {
  if (kind === "ellipse") {
    return (
      <div className="flex h-8 w-14 items-center justify-center">
        <div className="h-7 w-12 rounded-full border border-slate-500 bg-white" />
      </div>
    );
  }

  if (kind === "diamond") {
    return (
      <div className="flex h-8 w-14 items-center justify-center">
        <div className="size-7 rotate-45 border border-slate-500 bg-white" />
      </div>
    );
  }

  return (
    <div className="flex h-8 w-14 items-center justify-center">
      <div
        className={cn(
          "h-7 w-12 border border-slate-500 bg-white",
          kind === "rounded" ? "rounded-[14px]" : "rounded-sm",
        )}
      />
    </div>
  );
}
