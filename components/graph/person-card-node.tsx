"use client";

import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";
import Image from "next/image";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { LocateFixed, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { AppEdge, AppNode, PersonCardData } from "./sample-graph";

function QuickActionButton({
  danger,
  icon,
  label,
  onClick,
}: {
  danger?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
        danger
          ? "text-rose-300 hover:bg-rose-400/10"
          : "text-slate-200 hover:bg-white/8",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function NodeMenuButton({ id, highlighted }: { id: string; highlighted?: boolean }) {
  const [open, setOpen] = useState(false);
  const { getNode, setCenter, setNodes, deleteElements } =
    useReactFlow<AppNode, AppEdge>();
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip(), shift({ padding: 12 })],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  const handleLocate = () => {
    const node = getNode(id);
    if (!node) {
      return;
    }

    const width = node.measured?.width ?? 220;
    const height = node.measured?.height ?? 190;

    setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1.05,
      duration: 500,
    });
    setOpen(false);
  };

  const handleToggleHighlight = () => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== id || node.type !== "personCard") {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            highlighted: !highlighted,
          },
        };
      }),
    );
    setOpen(false);
  };

  const handleDelete = async () => {
    await deleteElements({ nodes: [{ id }] });
    setOpen(false);
  };

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="nodrag nopan flex size-7 items-center justify-center rounded-full border border-slate-500/40 bg-slate-900/80 text-slate-300 transition hover:border-sky-400/40 hover:text-white"
        {...getReferenceProps()}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[70] w-44 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-[0_24px_50px_-20px_rgba(15,23,42,0.8)] backdrop-blur"
            {...getFloatingProps()}
          >
            <QuickActionButton
              icon={<LocateFixed className="size-4" />}
              label="聚焦节点"
              onClick={handleLocate}
            />
            <QuickActionButton
              icon={<Star className="size-4" />}
              label={highlighted ? "取消高亮" : "设为关键"}
              onClick={handleToggleHighlight}
            />
            <QuickActionButton
              icon={<Trash2 className="size-4" />}
              label="删除节点"
              onClick={handleDelete}
              danger
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function PersonCardNode({ data, id, selected }: NodeProps<AppNode>) {
  if (data == null || !("avatarLabel" in data)) {
    return null;
  }

  const personData = data as PersonCardData;

  return (
    <div
      className={cn(
        "w-[228px] rounded-[26px] border bg-slate-800/95 text-white shadow-[0_28px_80px_-26px_rgba(15,23,42,0.88)] transition",
        personData.highlighted
          ? "border-violet-300/80 ring-2 ring-violet-300/40"
          : selected
            ? "border-sky-300/80 ring-2 ring-sky-300/35"
            : "border-slate-500/30",
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />

      <div className="flex items-start justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-wide text-white">
            {personData.title}
          </p>
          <p className="mt-1 text-xs text-slate-300">{personData.subtitle}</p>
        </div>
        <NodeMenuButton id={id} highlighted={personData.highlighted} />
      </div>

      <div className="space-y-4 p-4">
        <div className="flex gap-3">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-4xl font-semibold text-slate-700 shadow-inner">
            {personData.imageUrl ? (
              <Image
                src={personData.imageUrl}
                alt={personData.title}
                fill
                unoptimized
                className="object-cover"
                sizes="80px"
              />
            ) : (
              <span>{personData.avatarLabel}</span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between rounded-2xl bg-slate-700/60 p-3 text-[11px] text-slate-200">
            <div className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">
              relation card
            </div>
            <p className="leading-5 text-slate-200">
              适合承载人物概览、关键备注与线索摘要。
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-2xl bg-slate-700/45 p-3 text-[11px] leading-5 text-slate-200">
          {personData.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
