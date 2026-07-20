import { fileURLToPath, URL } from "node:url";

export default {
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../frontend/src", import.meta.url)),
    },
  },
  ssr: {
    noExternal: true,
  },
};
