"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "warning" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };
type ToastContextValue = { notify: (message: string, kind?: ToastKind) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = "success") => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-2), { id, kind, message }]);
    const timer = setTimeout(() => dismiss(id), kind === "error" ? 7000 : 5000);
    timers.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);

  return <ToastContext.Provider value={{ notify }}>
    {children}
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
        <span className="toast-mark" aria-hidden="true">{toast.kind === "success" ? "✓" : toast.kind === "warning" ? "!" : toast.kind === "error" ? "×" : "i"}</span>
        <span className="toast-message">{toast.message}</span>
        <button className="toast-dismiss" type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">×</button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider.");
  return context.notify;
}

export function friendlyError(cause: unknown, fallback: string) {
  const error = cause as { message?: string; code?: string } | null;
  if (error?.code === "23505") return "An assignment already exists for this duty and zone area.";
  if (error?.code === "42501") return "You do not have permission to make this change.";
  if (/failed to fetch|network request failed|load failed|fetch failed/i.test(error?.message ?? "")) return "Connection problem. Check your internet connection and try again.";
  return error?.message || fallback;
}
