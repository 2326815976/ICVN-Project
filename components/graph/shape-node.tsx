"use client";

import Image from "next/image";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizeControl, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import {
  DIAMOND_VERTEX_INSET_PERCENT,
  SHAPE_NODE_DIMENSIONS,
  getShapeHandlePoint,
  type AppEdge,
  type AppNode,
  type ShapeNodeData,
} from "./sample-graph";

const HANDLE_POSITIONS = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

const RESIZE_HANDLE_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

const visibleHandleWrapClassName = "pointer-events-none absolute z-30 size-4";

const visibleHandleClassName =
  "size-full rounded-full border-2 border-white bg-sky-500 opacity-0 scale-90 transition group-hover:opacity-100 group-hover:scale-100";

const hiddenHandleClassName = "!size-6 !border-0 !bg-transparent !opacity-0";
const resizeHandleClassName = "nodrag nopan !border-2 !border-white !bg-sky-500";
const resizeHandleStyle = {
  width: 16,
  height: 16,
  borderRadius: "9999px",
  boxShadow: "0 0 0 1px rgba(14,165,233,0.22)",
  zIndex: 40,
};

function ensureEvenSize(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}


export function ShapeNode({ id, data, selected, width, height }: NodeProps<AppNode>) {
  const nodeData = data as ShapeNodeData;
  const { setNodes } = useReactFlow<AppNode, AppEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const [draft, setDraft] = useState(nodeData.text);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const defaultSize = SHAPE_NODE_DIMENSIONS[nodeData.kind];
  const nodeWidth = width ?? defaultSize.width;
  const nodeHeight = height ?? defaultSize.height;
  const renderNodeWidth = nodeData.kind === "diamond" ? ensureEvenSize(nodeWidth) : Math.round(nodeWidth);
  const renderNodeHeight = nodeData.kind === "diamond" ? ensureEvenSize(nodeHeight) : Math.round(nodeHeight);

  useEffect(() => {
    if (!editing) {
      setDraft(nodeData.text);
    }
  }, [editing, nodeData.text]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(id);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [id, nodeHeight, nodeWidth, nodeData.kind, updateNodeInternals]);

  const commitText = () => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === id && node.type === "shapeNode"
          ? {
              ...node,
              data: {
                ...node.data,
                text: draft.trimEnd(),
              },
            }
          : node,
      ),
    );
    setEditing(false);
  };

  const cancelText = () => {
    setDraft(nodeData.text);
    setEditing(false);
  };

  const hasText = nodeData.text.trim().length > 0;
  const hasImage = Boolean(nodeData.imageUrl);
  const visibleLineCount = Math.max(
    (editing ? draft : nodeData.text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length,
    1,
  );
  const editorMinHeight = Math.min(Math.max(visibleLineCount * 24 + 8, 40), 104);
  const contentMinHeight = hasImage
    ? Math.min(Math.max(visibleLineCount * 24 + 84, 92), 148)
    : Math.min(Math.max(visibleLineCount * 24 + 8, 40), 72);
  const minResizeWidth =
    nodeData.kind === "diamond" ? 132 : nodeData.kind === "ellipse" ? 132 : hasImage ? 132 : 96;
  const minResizeHeight = nodeData.kind === "diamond" ? 132 : hasImage ? 108 : 72;

  const commonFrameClassName = cn(
    "group relative transition-[box-shadow,transform] duration-200",
    nodeData.kind === "diamond"
      ? "bg-transparent"
      : "shadow-[0_18px_50px_-30px_rgba(15,23,42,0.25)]",
    nodeData.kind === "diamond"
      ? ""
      : selected
        ? "shadow-[0_22px_70px_-36px_rgba(37,99,235,0.35)]"
        : "hover:shadow-[0_20px_60px_-32px_rgba(15,23,42,0.28)]",
  );

  const diamondVertexInset = `${DIAMOND_VERTEX_INSET_PERCENT}%`;
  const diamondPolygonPoints = `50,${DIAMOND_VERTEX_INSET_PERCENT} ${100 - DIAMOND_VERTEX_INSET_PERCENT},50 50,${100 - DIAMOND_VERTEX_INSET_PERCENT} ${DIAMOND_VERTEX_INSET_PERCENT},50`;
  const diamondClipPath = `polygon(50% ${diamondVertexInset}, ${100 - DIAMOND_VERTEX_INSET_PERCENT}% 50%, 50% ${100 - DIAMOND_VERTEX_INSET_PERCENT}%, ${diamondVertexInset} 50%)`;

  const getHandlePoint = (handleId: (typeof HANDLE_POSITIONS)[number]["id"]) =>
    getShapeHandlePoint(
      {
        x: 0,
        y: 0,
        width: renderNodeWidth,
        height: renderNodeHeight,
        kind: nodeData.kind,
      },
      handleId,
    );

  const getVisibleHandlePointStyle = (handleId: (typeof HANDLE_POSITIONS)[number]["id"]): CSSProperties => {
    const handlePoint = getHandlePoint(handleId);

    return {
      left: `${handlePoint.x}px`,
      top: `${handlePoint.y}px`,
      right: "auto",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
      zIndex: 30,
    };
  };

  const getInteractiveHandleStyle = (handleId: (typeof HANDLE_POSITIONS)[number]["id"]): CSSProperties => {
    const handlePoint = getHandlePoint(handleId);

    switch (handleId) {
      case "top":
        return {
          left: `${handlePoint.x}px`,
          top: `${handlePoint.y}px`,
          right: "auto",
          bottom: "auto",
          transform: "translate(-50%, 0)",
          zIndex: 30,
        };
      case "right":
        return {
          left: `${handlePoint.x}px`,
          top: `${handlePoint.y}px`,
          right: "auto",
          bottom: "auto",
          transform: "translate(-100%, -50%)",
          zIndex: 30,
        };
      case "bottom":
        return {
          left: `${handlePoint.x}px`,
          top: `${handlePoint.y}px`,
          right: "auto",
          bottom: "auto",
          transform: "translate(-50%, -100%)",
          zIndex: 30,
        };
      case "left":
        return {
          left: `${handlePoint.x}px`,
          top: `${handlePoint.y}px`,
          right: "auto",
          bottom: "auto",
          transform: "translate(0, -50%)",
          zIndex: 30,
        };
      default:
        return {
          left: `${handlePoint.x}px`,
          top: `${handlePoint.y}px`,
          right: "auto",
          bottom: "auto",
          transform: "translate(-50%, -50%)",
          zIndex: 30,
        };
    }
  };

  const frameStyle =
    nodeData.kind === "diamond"
      ? {
          backgroundColor: "transparent",
          color: nodeData.textColor,
        }
      : {
          backgroundColor: nodeData.fillColor,
          borderColor: selected ? "#93c5fd" : nodeData.strokeColor,
          color: nodeData.textColor,
        };

  const content = editing ? (
    <textarea
      ref={inputRef}
      value={draft}
      rows={Math.max(visibleLineCount, 1)}
      placeholder="输入文字"
      className="nodrag nopan w-full resize-none border-none bg-transparent text-center text-base font-medium leading-6 outline-none placeholder:text-slate-300"
      style={{
        color: nodeData.textColor,
        minHeight: `${editorMinHeight}px`,
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitText}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelText();
          return;
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commitText();
        }
      }}
    />
  ) : (
    <div
      className="flex flex-col items-center justify-center gap-3 text-center"
      style={{ minHeight: `${contentMinHeight}px` }}
    >
      {hasImage ? (
        <div className="relative flex size-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <Image
            src={nodeData.imageUrl!}
            alt={nodeData.text || "节点图片"}
            fill
            unoptimized
            sizes="64px"
            className="object-cover"
          />
        </div>
      ) : null}
      {hasText ? (
        <div className="max-w-full whitespace-pre-wrap break-words text-base font-medium leading-6">
          {nodeData.text}
        </div>
      ) : selected ? (
        <div className="text-sm leading-6 text-slate-300">双击输入文字</div>
      ) : null}
    </div>
  );

  const innerClassName =
    nodeData.kind === "diamond"
      ? "relative flex items-center justify-center"
      : nodeData.kind === "ellipse"
        ? "flex items-center justify-center rounded-[999px] border bg-white px-6 py-5"
        : nodeData.kind === "rounded"
          ? "flex items-center justify-center rounded-[28px] border bg-white px-6 py-5"
          : "flex items-center justify-center rounded-[18px] border bg-white px-5 py-4";

  const resizeControls = selected
    ? RESIZE_HANDLE_POSITIONS.map((position) => (
        <NodeResizeControl
          key={position}
          position={position}
          minWidth={minResizeWidth}
          minHeight={minResizeHeight}
          keepAspectRatio={nodeData.kind === "diamond"}
          className={resizeHandleClassName}
          style={resizeHandleStyle}
        />
      ))
    : null;

  const handleElements = HANDLE_POSITIONS.map((handle) => (
    <Fragment key={handle.id}>
      <Handle
        id={`target-${handle.id}`}
        type="target"
        position={handle.position}
        className={hiddenHandleClassName}
        style={getInteractiveHandleStyle(handle.id)}
      />
      <Handle
        id={`source-${handle.id}`}
        type="source"
        position={handle.position}
        className={hiddenHandleClassName}
        style={getInteractiveHandleStyle(handle.id)}
      />
      <div aria-hidden="true" className={visibleHandleWrapClassName} style={getVisibleHandlePointStyle(handle.id)}>
        <div className={cn(visibleHandleClassName, selected && "!opacity-100 !scale-100")} />
      </div>
    </Fragment>
  ));

  return (
    <div className="group relative will-change-transform" onDoubleClick={() => setEditing(true)}>
      {resizeControls}
      <div
      className={cn(commonFrameClassName, innerClassName)}
      style={{
        ...frameStyle,
        width: renderNodeWidth,
        height: renderNodeHeight,
      }}
    >
        {handleElements}
        {nodeData.kind === "diamond" ? (
          <>
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              shapeRendering="geometricPrecision"
              className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_18px_32px_rgba(15,23,42,0.08)]"
            >
              <polygon
                points={diamondPolygonPoints}
                fill={nodeData.fillColor ?? "#ffffff"}
                stroke={selected ? "#93c5fd" : nodeData.strokeColor ?? "#cbd5e1"}
                strokeWidth={selected ? "1.5" : "1"}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <div
              className="relative z-10 flex h-full w-full items-center justify-center px-7 py-7"
              style={{
                clipPath: diamondClipPath,
                color: nodeData.textColor,
              }}
            >
              {content}
            </div>
          </>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
