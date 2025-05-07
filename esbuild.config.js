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
    minify: false,
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
    ],
    banner: {
      js: '#!/usr/bin/env node\n"use strict";',
    },
  })
  .catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
