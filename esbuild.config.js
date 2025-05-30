import * as esbuild from "esbuild";

// Configuration for esbuild - simplified version according to Task 003
const config = {
  entryPoints: ["src/main.js"],
  outfile: "dist/devcontext-server.js",
  platform: "node",
  format: "esm",
  bundle: true,
  target: "node18",
  // Note: Minification and sourcemaps explicitly excluded per Task 003
  // Tree-sitter grammar handling will be addressed in Story 6.1
};

// Run the build
esbuild.build(config).catch((err) => {
  console.error("Error building:", err);
  process.exit(1);
});

// Export the configuration for potential reuse
export default config;
