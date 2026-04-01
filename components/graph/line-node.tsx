"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LINE_WIDTH,
  type AppEdge,
  type AppNode,
  type LineNodeData,
} from "./sample-graph";
import { LINE_MIN_WIDTH, clearLineNodeAnchors, getLineNodeSize, snapLineNodeAuto } from "./line-snap";

type EndpointSide = "start" | "end";

const endpointHandleClassName =
  "nodrag nopan absolute top-1/2 z-20 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-sky-500 shadow-[0_0_0_1px_rgba(59,130,246,0.28)] transition";

function round(value: number) {
  return Math.round(value);
}

export function LineNode({ id, data, selected, width, height }: NodeProps<AppNode>) {
  const nodeData = data as LineNodeData;
  const { screenToFlowPosition, setNodes } = useReactFlow<AppNode, AppEdge>();
  const [draft, setDraft] = useState(nodeData.text);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lineWidth = Math.max(width ?? DEFAULT_LINE_WIDTH, LINE_MIN_WIDTH);
  const lineHeight = height ?? DEFAULT_LINE_HEIGHT;

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

  const commitText = () => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === id && node.type === "lineNode"
          ? {
              ...node,
              data: {
                ...node.data,
                text: draft.trim(),
              },
            }
          : node,
      ),
    );
    setEditing(false);
  };

  const updateEndpointDrag = (side: EndpointSide, clientX: number, clientY: number) => {
    const flowPoint = screenToFlowPosition({ x: clientX, y: clientY });

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== id || node.type !== "lineNode") {
          return node;
        }

        const nextNode = clearLineNodeAnchors(node);
        const { width: currentWidth, height: currentHeight } = getLineNodeSize(nextNode);
        const targetY = round(flowPoint.y - currentHeight / 2);

        if (side === "start") {
          const fixedEndX = nextNode.position.x + currentWidth;
          const nextX = Math.min(flowPoint.x, fixedEndX - LINE_MIN_WIDTH);
          const nextWidth = Math.max(fixedEndX - nextX, LINE_MIN_WIDTH);

          return {
            ...nextNode,
            position: {
              x: round(nextX),
              y: targetY,
            },
            width: round(nextWidth),
            initialWidth: round(nextWidth),
            height: currentHeight,
            initialHeight: currentHeight,
          };
        }

        const fixedStartX = nextNode.position.x;
        const nextEndX = Math.max(flowPoint.x, fixedStartX + LINE_MIN_WIDTH);
        const nextWidth = Math.max(nextEndX - fixedStartX, LINE_MIN_WIDTH);

        return {
          ...nextNode,
          position: {
            x: round(fixedStartX),
            y: targetY,
          },
          width: round(nextWidth),
          initialWidth: round(nextWidth),
          height: currentHeight,
          initialHeight: currentHeight,
        };
      }),
    );
  };

  const handleEndpointPointerDown = (side: EndpointSide) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      updateEndpointDrag(side, moveEvent.clientX, moveEvent.clientY);
    };

    const finalize = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finalize);
      window.removeEventListener("pointercancel", finalize);

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== id || node.type !== "lineNode") {
            return node;
          }

          const flowPoint = screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
          const nextNode = clearLineNodeAnchors(node);
          const { width: currentWidth, height: currentHeight } = getLineNodeSize(nextNode);
          const targetY = round(flowPoint.y - currentHeight / 2);

          const draggedNode =
            side === "start"
              ? (() => {
                  const fixedEndX = nextNode.position.x + currentWidth;
                  const nextX = Math.min(flowPoint.x, fixedEndX - LINE_MIN_WIDTH);
                  const nextWidth = Math.max(fixedEndX - nextX, LINE_MIN_WIDTH);

                  return {
                    ...nextNode,
                    position: {
                      x: round(nextX),
                      y: targetY,
                    },
                    width: round(nextWidth),
                    initialWidth: round(nextWidth),
                    height: currentHeight,
                    initialHeight: currentHeight,
                  };
                })()
              : (() => {
                  const fixedStartX = nextNode.position.x;
                  const nextEndX = Math.max(flowPoint.x, fixedStartX + LINE_MIN_WIDTH);
                  const nextWidth = Math.max(nextEndX - fixedStartX, LINE_MIN_WIDTH);

                  return {
                    ...nextNode,
                    position: {
                      x: round(fixedStartX),
                      y: targetY,
                    },
                    width: round(nextWidth),
                    initialWidth: round(nextWidth),
                    height: currentHeight,
                    initialHeight: currentHeight,
                  };
                })();

          return snapLineNodeAuto(draggedNode, currentNodes);
        }),
      );
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finalize);
    window.addEventListener("pointercancel", finalize);
  };

  const lineColor = nodeData.color ?? "#64748b";
  const showBubble = editing || selected || nodeData.text.trim().length > 0;
  const beginEditing = () => {
    setEditing(true);
  };
  const handleEditDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    beginEditing();
  };

  return (
    <div className="group/line relative overflow-visible" style={{ width: lineWidth, height: lineHeight }}>
      <button
        type="button"
        aria-label="拖拽起点"
        className={cn(
          endpointHandleClassName,
          "-left-3",
          selected ? "opacity-100" : "opacity-0 group-hover/line:opacity-100",
        )}
        onPointerDown={handleEndpointPointerDown("start")}
      />

      <button
        type="button"
        aria-label="拖拽终点"
        className={cn(
          endpointHandleClassName,
          "-right-3",
          selected ? "opacity-100" : "opacity-0 group-hover/line:opacity-100",
        )}
        onPointerDown={handleEndpointPointerDown("end")}
      />

      <div
        className="line-node-drag-handle absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 px-1"
        onDoubleClick={handleEditDoubleClick}
      >
        <div
          className={cn(
            "relative h-0 border-t-2 border-slate-500",
            nodeData.kind === "dashed" && "border-dashed",
          )}
          style={{ borderColor: lineColor }}
        >
          {nodeData.kind === "arrow" ? (
            <span
              className="absolute right-[2px] top-1/2 block size-3 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-slate-500"
              style={{ borderColor: lineColor }}
            />
          ) : null}
        </div>
      </div>

      <div
        className="nodrag nopan absolute left-1/2 top-1/2 z-10 flex min-h-8 min-w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
        onDoubleClick={handleEditDoubleClick}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            placeholder="输入说明"
            className="nodrag nopan w-36 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-center text-xs text-slate-700 outline-none ring-4 ring-sky-100"
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(nodeData.text);
                setEditing(false);
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                commitText();
              }
            }}
          />
        ) : showBubble ? (
          <div
            className={cn(
              "pointer-events-none rounded-full border px-3 py-1.5 text-xs font-medium shadow-[0_10px_25px_-20px_rgba(15,23,42,0.35)]",
              selected
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-500",
            )}
          >
            {nodeData.text.trim() || "双击可输入文字"}
          </div>
        ) : (
          <div aria-hidden="true" className="pointer-events-none h-8 min-w-24 rounded-full opacity-0" />
        )}
      </div>
    </div>
  );
}
