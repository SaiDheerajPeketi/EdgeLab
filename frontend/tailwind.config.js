/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090d",
          900: "#0d1117",
          850: "#111821",
          800: "#151d26",
          700: "#202a34",
        },
        signal: {
          cyan: "#32d3ee",
          green: "#22c55e",
          red: "#fb7185",
          amber: "#f59e0b",
        },
        // EdgeLab design system (Phase 1). Keeps `ink`/`signal` above for back-compat.
        edgelab: {
          base: "var(--bg-base)",
          surface: "var(--bg-surface)",
          "surface-2": "var(--bg-surface-2)",
          border: "var(--bg-border)",
          accent: "var(--accent-primary)",
          "accent-dim": "var(--accent-primary-dim)",
          "accent-glow": "var(--accent-primary-glow)",
          profit: "var(--profit)",
          loss: "var(--loss)",
          neutral: "var(--neutral)",
          warning: "var(--warning)",
          "text-primary": "var(--text-primary)",
          "text-secondary": "var(--text-secondary)",
          "text-muted": "var(--text-muted)",
          "text-accent": "var(--text-accent)",
        },
        chart: {
          label: "var(--chart-label)",
          tooltip: {
            background: "var(--chart-tooltip-background)",
            foreground: "var(--chart-tooltip-foreground)",
            muted: "var(--chart-tooltip-muted)",
          },
        },
      },
      fontFamily: {
        display: ['Syne Variable', "Syne", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['Inter Variable', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        data: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        panel: "0 18px 45px rgba(0, 0, 0, 0.28)",
        glow: "0 0 28px var(--accent-primary-glow)",
        card: "0 10px 30px rgba(0, 0, 0, 0.35)",
      },
      borderRadius: {
        "el-sm": "var(--radius-sm)",
        "el-md": "var(--radius-md)",
        "el-lg": "var(--radius-lg)",
        "el-xl": "var(--radius-xl)",
      },
      transitionTimingFunction: {
        "el-out": "var(--ease-out)",
        "el-spring": "var(--ease-spring)",
      },
    },
  },
  plugins: [],
};
