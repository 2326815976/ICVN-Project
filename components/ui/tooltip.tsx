"use client";

import {
  FloatingPortal,
  type Placement,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useState, type ReactNode } from "react";

type TooltipProps = {
  children: ReactNode;
  content: ReactNode;
  placement?: Placement;
};

export function Tooltip({ children, content, placement = "bottom" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
    placement,
  });

  const hover = useHover(context, { move: false, delay: { open: 120, close: 60 } });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);

  return (
    <>
      <span ref={refs.setReference} className="inline-flex" {...getReferenceProps()}>
        {children}
      </span>

      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[120] max-w-[240px] rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-[0_18px_36px_-20px_rgba(15,23,42,0.55)]"
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
