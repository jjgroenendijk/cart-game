import { defineConfig } from "vitest/config";

const domTests = ["src/core/FieldBuilder.test.ts", "src/core/Game*.test.ts", "src/ui/**/*.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          exclude: domTests,
          environment: "node",
          passWithNoTests: true,
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
      {
        test: {
          name: "dom",
          include: domTests,
          environment: "jsdom",
          setupFiles: ["./tools/dom-setup.ts"],
          passWithNoTests: true,
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
    ],
    passWithNoTests: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
