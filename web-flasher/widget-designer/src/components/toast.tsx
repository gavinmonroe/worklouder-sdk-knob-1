// WD toasts — the click-site feedback channel for every async action.
// Bottom-right stack of max 3; success/info auto-dismiss after 5s (paused on
// hover), errors stay until dismissed. Enter 200ms rise, exit 160ms fade.

import * as React from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastOptions {
  tone?: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  /** Force stickiness; danger toasts are always sticky. */
  sticky?: boolean;
}

interface ToastItem extends ToastOptions {
  id: number;
  leaving: boolean;
}

const TONE_ICONS: Record<ToastTone, IconName> = {
  success: "check-circle",
  info: "info",
  warning: "alert-triangle",
  danger: "x-circle",
};

const AUTO_DISMISS_MS = 5000;
const EXIT_MS = 180;
const MAX_STACK = 3;

/** Callable push (returns the toast id) plus targeted dismissal, so a sticky
 *  error toast can be invalidated the moment the failure it describes is
 *  resolved (e.g. a later compile succeeding). */
export interface ToastApi {
  (t: ToastOptions): number;
  /** Remove one toast by the id `toast()` returned. No-op when already gone. */
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastApi>(
  Object.assign(() => 0, { dismiss: () => {} }),
);

/** `const toast = useToast(); const id = toast({ tone: "danger", title: "…" }); toast.dismiss(id)` */
export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);
  const timersRef = React.useRef(new Map<number, number>());

  const clearTimer = React.useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = React.useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, EXIT_MS);
    },
    [clearTimer],
  );

  const schedule = React.useCallback(
    (item: ToastItem) => {
      const sticky = item.sticky || item.tone === "danger";
      if (sticky) return;
      clearTimer(item.id);
      timersRef.current.set(
        item.id,
        window.setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS),
      );
    },
    [clearTimer, dismiss],
  );

  const push = React.useCallback(
    (opts: ToastOptions) => {
      const item: ToastItem = { tone: "info", ...opts, id: ++idRef.current, leaving: false };
      setToasts((prev) => {
        const alive = prev.filter((t) => !t.leaving);
        const overflow = alive.length >= MAX_STACK ? alive.slice(0, alive.length - (MAX_STACK - 1)) : [];
        overflow.forEach((t) => clearTimer(t.id));
        const keep = prev.filter((t) => !overflow.includes(t));
        return [...keep, item];
      });
      schedule(item);
      return item.id;
    },
    [clearTimer, schedule],
  );

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  const api = React.useMemo<ToastApi>(
    () => Object.assign((opts: ToastOptions) => push(opts), { dismiss }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="wd-toaster">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="wd-toast"
              data-tone={t.tone}
              data-leaving={t.leaving || undefined}
              role={t.tone === "danger" ? "alert" : "status"}
              onMouseEnter={() => clearTimer(t.id)}
              onMouseLeave={() => schedule(t)}
            >
              <Icon name={TONE_ICONS[t.tone ?? "info"]} size={16} className="wd-toast-icon" />
              <div className="min-w-0 flex-1">
                <div className="wd-toast-title">{t.title}</div>
                {t.body && <div className="wd-toast-body">{t.body}</div>}
                {t.action && (
                  <button
                    type="button"
                    className="wd-toast-action"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label} →
                  </button>
                )}
              </div>
              <button type="button" className="wd-toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
