import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: {
        // Pragmatic gates: keep the headline totals from regressing below the
        // post-2026-08 coverage push; per-module targets can be tightened later.
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80,
      },
    },
  },
});