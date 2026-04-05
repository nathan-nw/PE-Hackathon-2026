"use client";

import { useEffect, useState } from "react";
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
}: {
  toast: WatchdogToastItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={cn(
        "animate-watchdog-toast border-border bg-card text-card-foreground pointer-events-auto",
        "flex max-w-[min(100vw-2rem,22rem)] items-start gap-2 rounded-lg border shadow-lg",
        "px-3 py-2.5 text-sm"
      )}
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
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setEl(document.body);
  }, []);

  if (!el || toasts.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed top-4 right-4 z-[200] flex max-w-[min(100vw-1rem,23rem)] flex-col items-end gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    el
  );
}
