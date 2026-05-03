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
      },
      boxShadow: {
        panel: "0 18px 45px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};
