// WD primitives — one recipe per concept, tokens only (no hardcoded colors).
// Recipes live in styles/index.css as .wd-* classes; these components are the
// single vocabulary every panel composes from.

import * as React from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { useToast } from "./toast";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ─── Card ──────────────────────────────────────────────────────────────────
export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("wd-card", props.className)} />;
}
export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("wd-card-header", props.className)} />;
}
/** Card titles are REAL headings (h2): the visual recipe lives entirely in
 *  .wd-card-title (preflight zeroes heading margins/size), so the promotion
 *  changes nothing on screen while giving screen readers a navigable outline —
 *  the app h1 lives in the topbar, section overlines inside cards are h3. */
export function CardTitle(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} className={cx("wd-card-title", props.className)} />;
}
export function CardDescription(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("wd-card-desc", props.className)} />;
}
export function CardContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("wd-card-body", props.className)} />;
}

// ─── Spinner ───────────────────────────────────────────────────────────────
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cx("wd-spinner", className)}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Button ────────────────────────────────────────────────────────────────
// "default" renders the secondary recipe; "destructive" renders danger.
type ButtonVariant = "default" | "secondary" | "primary" | "ghost" | "destructive" | "danger";
export function Button({
  variant = "default",
  size = "md",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  const dataVariant =
    variant === "primary" ? "primary"
    : variant === "ghost" ? "ghost"
    : variant === "destructive" || variant === "danger" ? "danger"
    : undefined; // default/secondary is the base recipe
  return (
    <button
      type="button"
      {...rest}
      data-variant={dataVariant}
      data-size={size === "sm" ? "sm" : undefined}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={cx("wd-btn", className)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

// ─── Input / Textarea / Label ──────────────────────────────────────────────
export function Input({
  mono = false,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...props}
      className={cx("wd-input", mono && "font-mono", props.className)}
    />
  );
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("wd-textarea", props.className)} />;
}
/** Native select in the Input recipe — labeled enums pick by NAME while the
 *  raw value stays visible in the caller's mono readout. */
export function Select({
  mono = false,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { mono?: boolean }) {
  return (
    <span className={cx("wd-selectwrap", className)}>
      <select {...props} className={cx("wd-select", mono && "font-mono")}>
        {children}
      </select>
      <Icon name="chevron-down" size={14} className="wd-select-chevron" />
    </span>
  );
}
export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cx("wd-label", props.className)} />;
}

// ─── Section label (overline recipe) ───────────────────────────────────────
export function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="wd-overline">{children}</div>
      {hint && <div className="text-2xs normal-case tracking-normal text-tertiary">{hint}</div>}
    </div>
  );
}

// ─── Tooltip (portal + fixed positioning; hover and focus-visible) ─────────
// Hints only — never load-bearing state. Anchored to the trigger's measured
// rect in two passes (render hidden → measure bubble → clamp into viewport),
// and dismissed on pointerdown/click, pointerleave, blur, Escape, scroll, and
// resize so a bubble can never strand on screen after activation.
let tooltipWarmUntil = 0;

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom";
}) {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const bubbleRef = React.useRef<HTMLSpanElement>(null);
  const timerRef = React.useRef<number | undefined>(undefined);
  // Activation suppresses re-show briefly, or the click-driven focus event
  // would resurrect the bubble the same instant pointerdown dismissed it.
  const suppressUntil = React.useRef(0);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const id = React.useId();

  const hideNow = React.useCallback(() => {
    window.clearTimeout(timerRef.current);
    setOpen((was) => {
      if (was) tooltipWarmUntil = Date.now() + 500;
      return false;
    });
    setPos(null);
  }, []);

  const dismissOnActivate = React.useCallback(() => {
    suppressUntil.current = Date.now() + 600;
    hideNow();
  }, [hideNow]);

  const show = React.useCallback(() => {
    if (Date.now() < suppressUntil.current) return;
    window.clearTimeout(timerRef.current);
    const delay = Date.now() < tooltipWarmUntil ? 0 : 300;
    timerRef.current = window.setTimeout(() => {
      const el = anchorRef.current;
      if (!el || !el.isConnected) return;
      const rect = el.getBoundingClientRect();
      // A zero-sized or off-screen anchor must never spawn a bubble.
      if (rect.width === 0 || rect.right < 0 || rect.left > window.innerWidth) return;
      setOpen(true);
    }, delay);
  }, []);

  // Two-pass placement: the bubble renders hidden first, then gets positioned
  // against the anchor's live rect using its own measured size.
  React.useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const margin = 8;
    // Collision boundaries, tightest wins. Stage: triggers inside the device
    // stage keep their bubbles INSIDE the canvas rect. Card: triggers inside
    // a card keep their bubbles within the card's CONTENT box horizontally
    // (the 16px padding edge), so a bubble never hangs into the pipeline's
    // stepper gutter or across the rail connector. Everywhere else the
    // boundary is the viewport.
    const stage = anchor.closest(".wd-stage");
    const s = stage ? stage.getBoundingClientRect() : null;
    const card = anchor.closest(".wd-card");
    const c = card ? card.getBoundingClientRect() : null;
    const cardPad = 16;
    let boundLeft = margin;
    if (s) boundLeft = Math.max(boundLeft, s.left + margin);
    if (c) boundLeft = Math.max(boundLeft, c.left + cardPad);
    let boundRight = window.innerWidth - margin;
    if (s) boundRight = Math.min(boundRight, s.right - margin);
    if (c) boundRight = Math.min(boundRight, c.right - cardPad);
    const boundTop = Math.max(margin, s ? s.top + margin : margin);
    const boundBottom = Math.min(window.innerHeight - margin, s ? s.bottom - margin : Infinity);
    // A card's header is content, not clearance: when the bubble above a
    // card-body trigger would land on the title/description, flip below.
    const body = anchor.closest(".wd-card-body");
    const flipGuard = body ? Math.max(boundTop, body.getBoundingClientRect().top) : boundTop;
    let below = side === "bottom";
    if (!below && a.top - b.height - margin < flipGuard) below = true;
    if (below && a.bottom + b.height + margin > boundBottom && a.top - b.height - margin >= flipGuard)
      below = false;
    // Prefer centered on the trigger; when that would clamp against a
    // boundary edge, fall back to start/end alignment with the trigger so the
    // bubble always reads as attached to it, never pinned to the edge.
    const hi = boundRight - b.width;
    let left = a.left + a.width / 2 - b.width / 2;
    if (left < boundLeft) left = Math.min(Math.max(a.left, boundLeft), Math.max(hi, boundLeft));
    else if (left > hi) left = Math.max(Math.min(a.right - b.width, hi), boundLeft);
    const top = below ? a.bottom + margin : a.top - margin - b.height;
    setPos({ left, top });
  }, [open, side, label]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideNow();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hideNow, { capture: true });
    window.addEventListener("resize", hideNow);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hideNow, { capture: true });
      window.removeEventListener("resize", hideNow);
    };
  }, [open, hideNow]);

  React.useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hideNow}
      onPointerDown={dismissOnActivate}
      onClick={dismissOnActivate}
      onFocus={show}
      onBlur={hideNow}
    >
      {children}
      {open &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            ref={bubbleRef}
            className="wd-tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

// ─── Popover (portal + fixed positioning; anchored menus/settings) ─────────
// The Tooltip's portal pattern, promoted to interactive content: renders
// hidden first, measures itself, then clamps under (or above) its anchor
// inside the viewport. Dismissed on Escape, outside pointerdown, and resize —
// a popover must never strand on screen after its anchor scrolled away.
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  "aria-label": ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const margin = 8;
    // End-aligned to the anchor (the trigger lives in the topbar's right
    // cluster), clamped into the viewport.
    let left = Math.min(a.right - b.width, window.innerWidth - margin - b.width);
    left = Math.max(margin, left);
    let top = a.bottom + 6;
    if (top + b.height > window.innerHeight - margin) {
      top = Math.max(margin, a.top - b.height - 6);
    }
    setPos({ left, top });
  }, [open, anchorRef]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const bubble = bubbleRef.current;
      const anchor = anchorRef.current;
      const target = e.target as Node | null;
      if (bubble && target && !bubble.contains(target) && !(anchor && anchor.contains(target))) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={bubbleRef}
      role="dialog"
      aria-label={ariaLabel}
      className="wd-popover"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ─── Segmented control (value pickers — "raised key") ──────────────────────
export interface TabsProps<T extends string> {
  value: T;
  onValueChange: (v: T) => void;
  items: { id: T; label: React.ReactNode; hint?: React.ReactNode }[];
  className?: string;
}
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  items,
  className,
  semantics = "tab",
  ...rest
}: TabsProps<T> & { semantics?: "tab" | "radio" } & Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "className"
  >) {
  const activeIdx = items.findIndex((it) => it.id === value);
  const move = (e: React.KeyboardEvent) => {
    // No item selected (e.g. a custom zoom level): arrows start from the
    // first item instead of dead-ending.
    const idx = activeIdx < 0 ? 0 : activeIdx;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onValueChange(items[next].id);
    }
  };
  const radio = semantics === "radio";
  return (
    <div
      {...rest}
      className={cx("wd-seg", className)}
      role={radio ? "radiogroup" : "tablist"}
      onKeyDown={move}
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          role={radio ? "radio" : "tab"}
          type="button"
          aria-selected={radio ? undefined : it.id === value}
          aria-checked={radio ? it.id === value : undefined}
          // Roving tabindex; when nothing matches (custom value) the first
          // item stays reachable so the group never falls out of tab order.
          tabIndex={(activeIdx < 0 ? i === 0 : it.id === value) ? 0 : -1}
          onClick={() => onValueChange(it.id)}
          className="wd-seg-item"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
// Legacy alias — existing panels import Tabs; primary nav gets underline tabs
// in the shell pass, value pickers keep this recipe.
export const Tabs = SegmentedControl;

// ─── Primary navigation (underline tabs) ───────────────────────────────────
// The one recipe for page-level nav: 48px hit area, animated 2px accent bar.
// Value pickers use SegmentedControl instead — distinct semantics on purpose.
// MANUAL activation (WAI-ARIA tabs, option B): Arrow/Home/End move focus
// only; Enter/Space (or click) activates — traversing the tablist never
// mounts the heavyweight panes in between.
export function TabNav<T extends string>({
  value,
  onValueChange,
  items,
  className,
  "aria-label": ariaLabel,
}: TabsProps<T> & { "aria-label"?: string }) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const buttonsRef = React.useRef(new Map<T, HTMLButtonElement>());
  const [bar, setBar] = React.useState<{ left: number; width: number } | null>(null);
  // Roving-tabindex focus, tracked separately from the active tab.
  const [focusId, setFocusId] = React.useState<T | null>(null);

  const measure = React.useCallback(() => {
    const el = buttonsRef.current.get(value);
    if (!el) return;
    setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, items]);

  React.useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [measure]);

  const move = (e: React.KeyboardEvent) => {
    const current = focusId ?? value;
    const idx = items.findIndex((it) => it.id === current);
    if (idx < 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      // Focus only — activation waits for Enter/Space (native button click).
      setFocusId(items[next].id);
      buttonsRef.current.get(items[next].id)?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cx("wd-tabs", className)}
      onKeyDown={move}
      onBlur={(e) => {
        // Focus left the tablist entirely → Tab re-enters on the active tab.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusId(null);
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          ref={(node) => {
            if (node) buttonsRef.current.set(it.id, node);
            else buttonsRef.current.delete(it.id);
          }}
          role="tab"
          type="button"
          aria-selected={it.id === value}
          tabIndex={(focusId ?? value) === it.id ? 0 : -1}
          onClick={() => {
            setFocusId(it.id);
            onValueChange(it.id);
          }}
          className="wd-tab"
        >
          {it.label}
        </button>
      ))}
      {bar && (
        <span
          aria-hidden="true"
          className="wd-tab-indicator"
          style={{ transform: `translateX(${bar.left}px)`, width: bar.width }}
        />
      )}
    </div>
  );
}

// ─── Accordion (multi-open; optional persisted open-state) ─────────────────
export interface AccordionItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  render: () => React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  /**
   * Header-row actions (e.g. a "Clear" ghost button). Rendered as a SIBLING
   * of the toggle button — never nested inside it — so both stay real,
   * separately-focusable controls.
   */
  actions?: React.ReactNode;
}
export function Accordion({
  items,
  className = "",
  storageKey,
  reveal,
  flush = false,
}: {
  items: AccordionItem[];
  className?: string;
  /** Persist open-state to localStorage as `wd-acc-<storageKey>`. */
  storageKey?: string;
  /**
   * Flush variant: no outer frame — sections divided by full-bleed hairlines,
   * for accordions that ARE a card's body (cards never nest, §3).
   */
  flush?: boolean;
  /**
   * Imperative reveal: whenever `nonce` increments, the item with `id` opens,
   * scrolls into view, and flash-highlights — used by "View diagnostics"
   * deep links and the footer issue button.
   */
  reveal?: { id: string; nonce: number };
}) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(`wd-acc-${storageKey}`);
        if (raw) return new Set<string>(JSON.parse(raw));
      } catch {
        /* fall through to defaults */
      }
    }
    return new Set(items.filter((i) => i.defaultOpen).map((i) => i.id));
  });

  const persist = React.useCallback(
    (next: ReadonlySet<string>) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(`wd-acc-${storageKey}`, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
    },
    [storageKey],
  );

  // While a body is mid-transition (160ms grid 0fr↔1fr) its content — and the
  // content sliding beneath it — is a moving target; marking the collapse
  // "settling" lets CSS turn pointer-events off so an animating section never
  // intercepts a click meant for what is settling into place below it.
  const [settling, setSettling] = React.useState<ReadonlySet<string>>(() => new Set());
  const settleTimers = React.useRef(new Map<string, number>());
  React.useEffect(() => {
    const timers = settleTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  const markSettling = (id: string) => {
    setSettling((prev) => new Set(prev).add(id));
    const prevTimer = settleTimers.current.get(id);
    if (prevTimer !== undefined) window.clearTimeout(prevTimer);
    settleTimers.current.set(
      id,
      // --wd-dur-base (160ms) plus a beat; a timer, not transitionend, so a
      // hidden/off-screen tab can never strand a section unclickable.
      window.setTimeout(() => {
        settleTimers.current.delete(id);
        setSettling((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 220),
    );
  };

  const toggle = (id: string) => {
    markSettling(id);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(next);
      return next;
    });
  };

  const rowRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [flashId, setFlashId] = React.useState<string | null>(null);
  const revealNonce = reveal?.nonce ?? 0;
  const revealId = reveal?.id;
  React.useEffect(() => {
    if (!revealId || revealNonce === 0) return;
    markSettling(revealId);
    setOpen((prev) => {
      if (prev.has(revealId)) return prev;
      const next = new Set(prev).add(revealId);
      persist(next);
      return next;
    });
    // Give a just-unhidden tab a beat to lay out before scrolling to the row.
    const timer = window.setTimeout(() => {
      const el = rowRefs.current.get(revealId);
      // The off-screen-hidden design tab parks at left:-20000px — never
      // scroll toward a row that isn't actually visible.
      if (el && el.getBoundingClientRect().left > -1000) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      setFlashId(revealId);
    }, 120);
    const clear = window.setTimeout(() => setFlashId(null), 1600);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce, revealId]);

  return (
    <div className={cx("wd-acc", className)} data-flush={flush ? "true" : undefined}>
      {items.map((it) => {
        const isOpen = open.has(it.id);
        return (
          <div
            key={it.id}
            ref={(node) => {
              if (node) rowRefs.current.set(it.id, node);
              else rowRefs.current.delete(it.id);
            }}
            data-flash={flashId === it.id || undefined}
            className="wd-acc-item"
          >
            <div className="wd-acc-head" data-actions={it.actions ? "true" : undefined}>
              <button
                type="button"
                onClick={() => toggle(it.id)}
                aria-expanded={isOpen}
                className="wd-acc-row"
              >
                <Icon name="chevron-right" size={14} className="wd-acc-chevron" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.title}</span>
                  {it.description && (
                    <span className="block truncate text-xs font-normal text-tertiary">{it.description}</span>
                  )}
                </span>
              </button>
              {/* Fixed trailing anatomy: [actions?] [badge] — the badge is
                  ALWAYS the last, flush-right slot, so counts form a column
                  down the card even when a group carries a header action.
                  Clicking the badge toggles, same as the row. */}
              {it.actions && <div className="wd-acc-actions">{it.actions}</div>}
              {it.badge && (
                <span className="wd-acc-badge" onClick={() => toggle(it.id)}>
                  {it.badge}
                </span>
              )}
            </div>
            {/* Body stays mounted so open/close can animate (grid 0fr→1fr,
                matching the 160ms chevron); `inert` keeps closed content out
                of the tab order and the accessibility tree. */}
            <div
              className="wd-acc-collapse"
              data-open={isOpen || undefined}
              data-settling={settling.has(it.id) || undefined}
              inert={!isOpen}
            >
              <div className="wd-acc-collapse-inner">
                <div className="wd-acc-body">{it.render()}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────
// Every empty explains the path out.
export function EmptyState({
  title,
  hint,
  icon,
  action,
  size = "md",
}: {
  title: string;
  hint?: React.ReactNode;
  icon?: IconName;
  action?: React.ReactNode;
  /** "sm" fits accordion bodies and rails; "md" fits full panel voids. */
  size?: "sm" | "md";
}) {
  return (
    <div className="wd-empty" data-size={size === "sm" ? "sm" : undefined}>
      {icon && <Icon name={icon} size={size === "sm" ? 24 : 32} className="wd-empty-icon" />}
      <div className="wd-empty-title">{title}</div>
      {hint && <div className="wd-empty-hint">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ─── Badge / status pill ───────────────────────────────────────────────────
// ≤3 words + a number; full sentences belong in a Callout.
type BadgeTone = "muted" | "neutral" | "accent" | "info" | "success" | "warning" | "destructive" | "danger";
export function Badge({
  tone = "muted",
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  /** Hover hint for badges whose value needs a sentence of provenance
   *  (e.g. the budgets "57%" = highest utilization across the meters). */
  title?: string;
}) {
  const dataTone =
    tone === "muted" || tone === "neutral" ? "neutral"
    : tone === "destructive" || tone === "danger" ? "danger"
    : tone;
  return (
    <span data-tone={dataTone} className={cx("wd-badge", className)} title={title}>
      {children}
    </span>
  );
}

// ─── Status dot & device-connection indicator ──────────────────────────────
export type StatusDotState = "idle" | "busy" | "ok" | "warn" | "error" | "info";
export function StatusDot({ state = "idle", className }: { state?: StatusDotState; className?: string }) {
  return <span aria-hidden="true" data-state={state} className={cx("wd-dot", className)} />;
}

// ─── Budget meter (§4.14 — the one budget vocabulary) ──────────────────────
// label · 4px track · "1,234 / 8,192" in tabular numerals. The fill carries
// threshold semantics — brand ember below 70%, amber at 70–90%, red at ≥90%
// (the same warning/danger tokens the diagnostics badges use), so a budget
// visibly escalates as it approaches its cap instead of staying brand-orange
// at every utilization. Caps always come from constants.ts at the call site.
/** The ONE utilization→tone mapping — fills and header badges must escalate
 *  at the same thresholds, so both read it from here. */
export function budgetTone(ratio: number): "accent" | "warning" | "danger" {
  return ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "warning" : "accent";
}

export function BudgetMeter({
  label,
  value,
  cap,
}: {
  label: string;
  /** null renders an explicitly-empty value ("—"), not a zero. */
  value: number | null;
  cap: number;
}) {
  const num = value ?? 0;
  const ratio = cap > 0 ? num / cap : 0;
  const tone = budgetTone(ratio);
  // A measured-but-tiny value floors at 2% of track (plus a 3px CSS minimum)
  // so a fresh 1,936 / 98,304 package reads as a DELIBERATE near-empty bar —
  // never a sub-pixel speck that looks like a rendering artifact. Only a true
  // zero (or explicit empty) draws no fill at all.
  const pct = num <= 0 ? 0 : Math.min(100, Math.max(2, ratio * 100));
  return (
    <div className="wd-meter">
      <span className="wd-meter-label">{label}</span>
      <span
        className="wd-meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={num}
      >
        <span
          className="wd-meter-fill"
          data-tone={tone}
          data-nonzero={num > 0 || undefined}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="wd-meter-value wd-nums">
        <span data-empty={value === null || undefined}>{value === null ? "—" : num.toLocaleString()}</span>
        <span className="wd-meter-sep" aria-hidden="true">/</span>
        {cap.toLocaleString()}
      </span>
    </div>
  );
}

// ─── Stage nodes (§4.15 — pipeline / push-flow progress) ───────────────────
// One node vocabulary for every staged flow: the Export pipeline's stage rail
// and the Device tab's build→push flow share this recipe, so "done" or
// "failed" reads identically everywhere.
//
// Deliberately UNNUMBERED: these are stages with independent status, not an
// enforced 1-2-3 sequence — Assemble can legitimately complete while Compile
// sits unbuilt (they are separate build paths), and a numbered rail would
// assert an order the flow does not enforce. Status glyphs only: hollow dot
// (pending) · ember core + halo (active) · spinner (busy) · check (done) ·
// x (failed) · ! (warning — a related surface needs attention).
export type StepState = "pending" | "active" | "busy" | "done" | "failed" | "warning";

export function StepNode({ state }: { state: StepState }) {
  return (
    <span className="wd-stepnode" data-state={state} aria-hidden="true">
      {state === "done" ? (
        <Icon name="check" size={11} strokeWidth={2} />
      ) : state === "failed" ? (
        <Icon name="x" size={11} strokeWidth={2} />
      ) : state === "warning" ? (
        <Icon name="alert-triangle" size={11} strokeWidth={2} />
      ) : state === "busy" ? (
        <Spinner size={12} />
      ) : (
        <span className="wd-stepnode-core" />
      )}
    </span>
  );
}

const STEP_STATE_LABEL: Record<StepState, string> = {
  pending: "pending",
  active: "ready",
  busy: "in progress",
  done: "complete",
  failed: "failed",
  warning: "needs attention",
};

export interface StepItem {
  id: string;
  state: StepState;
  label: React.ReactNode;
  /** 12px tertiary line under the label — mode notes, gate summaries. */
  detail?: React.ReactNode;
  /** Step content: controls, callouts, artifact badges. */
  children?: React.ReactNode;
}

export function Stepper({ steps, className }: { steps: StepItem[]; className?: string }) {
  return (
    // <ul> on purpose: stages carry independent status, not an ordered count.
    <ul className={cx("wd-stepper", className)}>
      {steps.map((s) => (
        <li key={s.id} className="wd-step" data-state={s.state}>
          <div className="wd-step-rail">
            <StepNode state={s.state} />
            <span className="wd-step-line" aria-hidden="true" />
          </div>
          <div className="wd-step-main">
            {/* h3 under the owning card's h2 — the visual recipe is the class;
                the state suffix stays sr-only inside the heading so "Build
                package, failed" reads as one navigable item. */}
            <h3 className="wd-step-label">
              {s.label}
              <span className="sr-only">, {STEP_STATE_LABEL[s.state]}</span>
            </h3>
            {s.detail && <div className="wd-step-detail">{s.detail}</div>}
            {s.children && <div className="wd-step-body">{s.children}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Key-value table (§4.13) ───────────────────────────────────────────────
// Values sit NEXT to their keys — never flushed to the far edge of a wide row.
export interface KVRow {
  key: React.ReactNode;
  value: React.ReactNode;
  /** Mono variant for hex, ids, shas. */
  mono?: boolean;
}
export function KVTable({ rows, className }: { rows: KVRow[]; className?: string }) {
  return (
    <dl className={cx("wd-kv", className)}>
      {rows.map((r, i) => (
        <div className="wd-kv-tr" key={i}>
          <dt className="wd-kv-key">{r.key}</dt>
          <dd className="wd-kv-val" data-mono={r.mono || undefined}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Issue block (callout + one-line summary + "Show details" dump) ────────
// The one failure/blocked presentation for pipeline surfaces: a human summary,
// optional remedy links, and the full compiler text behind a disclosure in a
// monospace scroll area. Raw dumps never render verbatim in shell chrome.
//
// A disclosure must EARN its click: when the detail is just the summary again
// (mode prefix stripped, whitespace collapsed), no "Show details" renders at
// all — a reveal that adds zero information is worse than none. `copyText`
// adds a "Copy error" action for failures worth pasting into a bug report.

/** Mode prefixes the summaries strip — the comparison must strip them too. */
const ISSUE_PREFIX = /^(?:F2JS|widget upload|render-v2|event-driven):\s*/i;
function normalizeIssueText(s: string): string {
  return s.replace(ISSUE_PREFIX, "").replace(/\s+/g, " ").trim().replace(/\.$/, "").toLowerCase();
}

export function IssueBlock({
  tone,
  summary,
  detail,
  copyText,
  children,
}: {
  tone: "info" | "warning" | "danger";
  summary: React.ReactNode;
  detail?: string;
  /** Renders a "Copy error" action; the payload the clipboard receives. */
  copyText?: string;
  children?: React.ReactNode;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const trimmed = detail?.trim() ?? "";
  const summaryText = typeof summary === "string" ? summary : null;
  // Detail is informative when it says MORE than the summary already did.
  const hasDetail =
    trimmed !== "" &&
    (summaryText === null || !normalizeIssueText(summaryText).includes(normalizeIssueText(trimmed)));

  const copy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A rejected clipboard write must never fail silently.
      toast({
        tone: "danger",
        title: "Copy failed",
        body: "The browser blocked clipboard access — open the details and select the text manually.",
      });
    }
  };

  return (
    <Callout tone={tone}>
      <span>
        {summary}
        {children && <> {children}</>}
      </span>
      {(hasDetail || copyText) && (
        <span className="wd-issue-actions">
          {hasDetail && (
            <button
              type="button"
              className="wd-disclose"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name="chevron-right" size={12} className="wd-disclose-chevron" />
              {open ? "Hide details" : "Show details"}
            </button>
          )}
          {copyText && (
            <button type="button" className="wd-disclose" onClick={copy}>
              <Icon name={copied ? "check" : "copy"} size={12} />
              {copied ? "Copied" : "Copy error"}
            </button>
          )}
        </span>
      )}
      {hasDetail && open && <pre className="wd-issue-detail">{detail}</pre>}
    </Callout>
  );
}

// ─── Inline callout (full sentences live here, not in badges) ──────────────
const CALLOUT_ICONS: Record<"info" | "success" | "warning" | "danger", IconName> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "x-circle",
};
export function Callout({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-tone={tone} role={tone === "danger" ? "alert" : undefined} className={cx("wd-callout", className)}>
      <Icon name={CALLOUT_ICONS[tone]} size={14} className="wd-callout-icon" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
