import react from "../../frontend/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { fileURLToPath, URL } from "node:url";

export default {
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../frontend/src", import.meta.url)),
    },
  },
  ssr: {
    noExternal: true,
  },
};
