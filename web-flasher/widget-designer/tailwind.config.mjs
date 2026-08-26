/** @type {import('tailwindcss').Config} */
// Every color is a var(--wd-*) passthrough — the palette lives in
// src/styles/index.css and swaps wholesale between light and dark themes.
// Both spellings (fg/foreground, bg/background, muted-fg/muted-foreground)
// are defined during migration so no class silently no-ops.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,tsx,jsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
    },
    extend: {
      colors: {
        bg: "var(--wd-bg)",
        background: "var(--wd-bg)",
        fg: "var(--wd-text-primary)",
        foreground: "var(--wd-text-primary)",

        card: "var(--wd-surface-panel)",
        panel: "var(--wd-surface-panel)",
        raised: "var(--wd-surface-raised)",
        overlay: "var(--wd-surface-overlay)",
        inset: "var(--wd-surface-inset)",
        muted: "var(--wd-surface-inset)",

        "muted-fg": "var(--wd-text-secondary)",
        "muted-foreground": "var(--wd-text-secondary)",
        secondary: "var(--wd-text-secondary)",
        tertiary: "var(--wd-text-tertiary)",
        disabled: "var(--wd-text-disabled)",

        border: {
          DEFAULT: "var(--wd-border-subtle)",
          subtle: "var(--wd-border-subtle)",
          strong: "var(--wd-border-strong)",
        },
        input: "var(--wd-border-strong)",
        ring: "var(--wd-ring)",

        primary: {
          DEFAULT: "var(--wd-accent)",
          fg: "var(--wd-text-on-accent)",
          foreground: "var(--wd-text-on-accent)",
        },
        accent: {
          DEFAULT: "var(--wd-accent)",
          hover: "var(--wd-accent-hover)",
          active: "var(--wd-accent-active)",
          strong: "var(--wd-accent-strong)",
          subtle: "var(--wd-accent-subtle)",
          border: "var(--wd-accent-border)",
          fg: "var(--wd-text-on-accent)",
          foreground: "var(--wd-text-on-accent)",
        },
        destructive: {
          DEFAULT: "var(--wd-danger)",
          fg: "var(--wd-text-on-accent)",
          foreground: "var(--wd-text-on-accent)",
          subtle: "var(--wd-danger-subtle)",
          border: "var(--wd-danger-border)",
        },
        danger: {
          DEFAULT: "var(--wd-danger)",
          hover: "var(--wd-danger-hover)",
          subtle: "var(--wd-danger-subtle)",
          border: "var(--wd-danger-border)",
        },
        success: {
          DEFAULT: "var(--wd-success)",
          subtle: "var(--wd-success-subtle)",
          border: "var(--wd-success-border)",
        },
        warning: {
          DEFAULT: "var(--wd-warning)",
          subtle: "var(--wd-warning-subtle)",
          border: "var(--wd-warning-border)",
        },
        info: {
          DEFAULT: "var(--wd-info)",
          subtle: "var(--wd-info-subtle)",
          border: "var(--wd-info-border)",
        },
      },
      borderRadius: {
        xs: "var(--wd-radius-xs)",
        sm: "var(--wd-radius-sm)",
        md: "var(--wd-radius-md)",
        lg: "var(--wd-radius-lg)",
        xl: "var(--wd-radius-xl)",
      },
      boxShadow: {
        wd1: "var(--wd-shadow-1)",
        wd2: "var(--wd-shadow-2)",
        wd3: "var(--wd-shadow-3)",
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "16px", letterSpacing: "0.06em" }],
        xs: ["12px", "18px"],
        sm: ["13px", "20px"],
        base: ["14px", "22px"],
        lg: ["16px", "24px"],
        xl: ["20px", "28px"],
      },
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Segoe UI Variable",
          "Segoe UI", "Inter", "Roboto", "Helvetica Neue", "Arial", "sans-serif",
        ],
        mono: [
          "ui-monospace", "SF Mono", "SFMono-Regular", "Menlo", "Cascadia Code",
          "Consolas", "Liberation Mono", "monospace",
        ],
      },
      transitionTimingFunction: {
        wd: "cubic-bezier(0.2, 0, 0, 1)",
        "wd-out": "cubic-bezier(0.16, 1, 0.3, 1)",
        "wd-in": "cubic-bezier(0.7, 0, 0.84, 0)",
      },
    },
  },
  plugins: [],
};
