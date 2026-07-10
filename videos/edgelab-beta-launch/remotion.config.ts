import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.overrideWebpackConfig((currentConfiguration) => {
  const packageNodeModules = path.resolve("./node_modules");
  const frontendSrc = path.resolve("../../frontend/src");

  return {
    ...currentConfiguration,
    resolve: {
      ...currentConfiguration.resolve,
      alias: {
        ...(currentConfiguration.resolve?.alias ?? {}),
        "@": frontendSrc,
      },
      modules: [
        packageNodeModules,
        ...(currentConfiguration.resolve?.modules ?? []),
      ],
    },
  };
});
