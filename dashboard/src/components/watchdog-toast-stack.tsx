"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type WatchdogToastItem = {
  id: string;
  message: string;
  at: string;
};

const AUTO_DISMISS_MS = 9_000;

function ToastRow({
  toast,
  onDismiss,
  className,
  style,
}: {
  toast: WatchdogToastItem;
  onDismiss: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={cn(
        "animate-watchdog-toast border-border bg-card text-card-foreground",
        "flex max-w-[min(100vw-2rem,22rem)] items-start gap-2 rounded-lg border shadow-lg",
        "px-3 py-2.5 text-sm",
        className
      )}
      style={style}
      role="status"
    >
      <AlertTriangle
        className="text-amber-600 mt-0.5 size-4 shrink-0 dark:text-amber-500"
        aria-hidden
      />
      <p className="min-w-0 flex-1 leading-snug">{toast.message}</p>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground -mr-0.5 -mt-0.5 shrink-0 rounded p-0.5"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function WatchdogToastStack({
  toasts,
  onDismiss,
}: {
  toasts: WatchdogToastItem[];
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!isClient || toasts.length === 0) return null;

  const n = toasts.length;
  const fanDeg = (i: number) => {
    if (n <= 1) return 0;
    const mid = (n - 1) / 2;
    return (i - mid) * 2.25;
  };

  return createPortal(
    <div
      className="pointer-events-none fixed top-4 right-4 z-[200] flex max-w-[min(100vw-1rem,23rem)] flex-col items-end"
      aria-live="polite"
    >
      <div
        className={cn(
          "pointer-events-auto flex flex-col items-stretch transition-[padding] duration-300 ease-out",
          expanded && "pb-1"
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setExpanded(false);
          }
        }}
        role="region"
        aria-expanded={n > 1 ? expanded : undefined}
        aria-label={
          n > 1
            ? `${n} watchdog notifications stacked — hover or focus to expand`
            : "Watchdog notification"
        }
      >
        {toasts.map((t, i) => (
          <ToastRow
            key={t.id}
            toast={t}
            onDismiss={onDismiss}
            className={cn(
              "relative transition-[margin,transform,box-shadow,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              /* 3.5rem overlap ≈ card height minus visible strip */
              i > 0 && !expanded && "-mt-14",
              i > 0 && expanded && "mt-3",
              i === 0 && expanded && n > 1 && "shadow-xl",
              !expanded && i > 0 && "opacity-95",
              expanded && "opacity-100"
            )}
            style={{
              zIndex: n - i,
              transform: expanded ? `rotate(${fanDeg(i)}deg)` : undefined,
              transformOrigin: expanded ? "center top" : undefined,
            }}
          />
        ))}
      </div>
    </div>,
    document.body
  );
}
