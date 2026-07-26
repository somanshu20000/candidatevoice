import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` -> `./src/*` path alias in tsconfig.json.
      "@": path.resolve(process.cwd(), "src"),
    },
  },
});
