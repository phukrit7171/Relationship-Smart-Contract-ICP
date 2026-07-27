import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.js on purpose.
 *
 * That config runs the `icpBindgen` plugin and shells out to the `icp` CLI,
 * neither of which a unit-test run needs — and both of which resolve paths
 * relative to a root vitest sets differently, so reusing it fails before a
 * single test runs.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{js,jsx}"],
    // Component tests opt into jsdom with a `@vitest-environment` comment;
    // the pure-logic tests stay on node, which starts far faster.
    environment: "node",
  },
});
