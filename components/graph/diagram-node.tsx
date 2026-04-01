"use client";

import Image from "next/image";
import { Fragment } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import type { AppNode, DiagramNodeData } from "./sample-graph";

const HANDLE_POSITIONS = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

const visibleHandleClassName =
  "!size-3 !border-2 !border-white !bg-sky-500 !shadow-[0_0_0_1px_rgba(59,130,246,0.35)] !opacity-0 !scale-90 transition group-hover:!opacity-100 group-hover:!scale-100";

const hiddenHandleClassName = "!size-5 !border-0 !bg-transparent";

export function DiagramNode({ data, selected }: NodeProps<AppNode>) {
  const nodeData = data as DiagramNodeData;
  const visibleNotes = nodeData.notes.filter(Boolean).slice(0, 3);

  return (
    <div
      className={cn(
        "group relative w-[248px] rounded-[26px] border bg-white px-4 py-4 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.28)] transition",
        selected
          ? "border-sky-500 ring-4 ring-sky-100"
          : "border-slate-200 hover:border-slate-300 hover:shadow-[0_20px_60px_-30px_rgba(15,23,42,0.32)]",
      )}
    >
      {HANDLE_POSITIONS.map((handle) => (
        <Fragment key={handle.id}>
          <Handle
            id={`target-${handle.id}`}
            type="target"
            position={handle.position}
            className={hiddenHandleClassName}
          />
          <Handle
            id={`source-${handle.id}`}
            type="source"
            position={handle.position}
            className={cn(visibleHandleClassName, selected && "!opacity-100 !scale-100")}
          />
        </Fragment>
      ))}

      <div className="flex items-start gap-3">
        <div className="relative flex size-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {nodeData.imageUrl ? (
            <Image
              src={nodeData.imageUrl}
              alt={nodeData.title}
              fill
              unoptimized
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-medium text-slate-400">
              插入图片
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-slate-900">{nodeData.title}</p>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            {nodeData.subtitle || "在右侧属性面板补充说明"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {visibleNotes.length > 0 ? (
          visibleNotes.map((line) => (
            <div
              key={line}
              className="rounded-2xl bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-600"
            >
              {line}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-400">
            暂无说明，点击右侧可补充内容。
          </div>
        )}
      </div>
    </div>
  );
}
