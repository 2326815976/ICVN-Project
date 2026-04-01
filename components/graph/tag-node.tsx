"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import type { AppNode, TagNodeData } from "./sample-graph";

export function TagNode({ data, selected }: NodeProps<AppNode>) {
  if (data == null || !("title" in data)) {
    return null;
  }

  const tagData = data as TagNodeData;

  return (
    <div
      className={cn(
        "min-w-[180px] max-w-[280px] rounded-2xl border px-4 py-3 text-white shadow-[0_18px_45px_-24px_rgba(15,23,42,0.85)] transition",
        tagData.tone === "accent"
          ? "border-sky-300/60 bg-slate-700/95"
          : tagData.tone === "warning"
            ? "border-amber-300/60 bg-slate-700/95"
            : "border-slate-500/35 bg-slate-700/90",
        selected && "ring-2 ring-sky-300/35",
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />

      <p className="text-sm font-semibold text-white">{tagData.title}</p>
      {tagData.subtitle ? (
        <p className="mt-1 text-xs leading-5 text-slate-300">{tagData.subtitle}</p>
      ) : null}
    </div>
  );
}
