import esbuild from "esbuild";
import { nodeExternalsPlugin } from "esbuild-node-externals";

esbuild
  .build({
    entryPoints: ["src/main.js"],
    bundle: true,
    platform: "node",
    target: "node18",
    outfile: "dist/mcp-server.bundle.js",
    format: "esm",
    minify: true,
    sourcemap: true,
    plugins: [nodeExternalsPlugin()],
    external: [
      "@libsql/client",
      "@modelcontextprotocol/sdk",
      "acorn",
      "uuid",
      "zod",
      "dotenv",
      "fs",
      "path",
      "url",
      "os",
      "util",
      "crypto",
    ],
    banner: {
      js: '#!/usr/bin/env node\n"use strict";',
    },
    metafile: true,
  })
  .then((result) => {
    // Report bundle size
    const outputSize = Object.values(result.metafile.outputs)[0].bytes;
    console.log(`Bundle size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
  })
  .catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
