// WD theme infrastructure.
// - <html data-theme="light|dark"> is the switch; no attribute = follow system.
// - Explicit choices persist to localStorage "wd-theme" ("light"|"dark"|"system").
// - A boot script in index.html applies the stored attribute before first
//   paint; this module owns runtime changes plus the 200ms cross-fade.

import * as React from "react";
import { Icon } from "./icons";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "wd-theme";
const CROSSFADE_MS = 240;

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme actually in effect right now (attribute wins, else system). */
export function resolvedTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return systemTheme();
}

export function storedThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

let crossfadeTimer: number | undefined;

/** Apply + persist a theme preference, with a calm cross-fade. */
export function applyTheme(pref: ThemePreference, animate = true) {
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate && !reduced) {
    root.classList.add("wd-theming");
    window.clearTimeout(crossfadeTimer);
    crossfadeTimer = window.setTimeout(() => root.classList.remove("wd-theming"), CROSSFADE_MS);
  }
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage unavailable */
  }
}

/** Icon-only ghost toggle (32×32, matching the adjacent 32px buttons).
 *  Sun shows in dark, moon in light. */
export function ThemeToggle() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => resolvedTheme());

  // Track OS changes while following the system preference.
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(resolvedTheme());
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="wd-iconbtn"
      data-size="lg"
      onClick={toggle}
      aria-label="Toggle theme"
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
