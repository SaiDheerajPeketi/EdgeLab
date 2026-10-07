import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { createPineEnginePlugin } from "../scripts/pine-engine.mjs";

const virtualId = "virtual:pine-worker-url";
const resolvedId = `\0${virtualId}`;
const developmentPath = "/@edgelab/pine-native-worker.js";

/** One classic, self-contained asset: the opaque worker cannot import modules. */
export function pineWorkerPlugin(): Plugin {
  let asset: string | undefined;
  let production = false;
  const bundle = async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("./src/workers/pineNative.worker.ts", import.meta.url))],
      bundle: true,
      format: "iife",
      platform: "browser",
      conditions: ["browser"],
      target: "es2020",
      minify: true,
      plugins: [createPineEnginePlugin()],
      legalComments: "inline",
      banner: { js: "/*! PineTS 0.11.0 + EdgeLab realtime-57 source patches | Copyright (C) 2026-present LuxAlgo | AGPL-3.0-only | See /THIRD_PARTY_NOTICES.txt and /LICENSE.txt */" },
      write: false,
    });
    return result.outputFiles[0].text;
  };
  return {
    name: "edgelab-pine-worker",
    configResolved(config) { production = config.command === "build"; },
    resolveId(id) { if (id === virtualId) return resolvedId; },
    async buildStart() {
      if (production) asset = this.emitFile({ type: "asset", name: "pine-native-worker.js", source: await bundle() });
    },
    load(id) {
      if (id !== resolvedId) return;
      return production
        ? `export default import.meta.ROLLUP_FILE_URL_${asset};`
        : `export default ${JSON.stringify(developmentPath)};`;
    },
    configureServer(server) {
      server.middlewares.use(developmentPath, async (_request, response) => {
        try {
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(await bundle());
        } catch {
          response.statusCode = 500;
          response.end("Pine worker could not be built.");
        }
      });
    },
  };
}
