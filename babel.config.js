/**
 * Babel Configuration for DevContext
 *
 * This configuration allows Jest to properly handle ES modules.
 */

export default {
  presets: [
    [
      "@babel/preset-env",
      {
        targets: {
          node: "current",
        },
        modules: false, // Keep ES modules as ES modules
      },
    ],
  ],
  // Add special handling for test environment
  env: {
    test: {
      presets: [
        [
          "@babel/preset-env",
          {
            targets: {
              node: "current",
            },
          },
        ],
      ],
    },
  },
};
