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
        },
      },
      {
        test: {
          name: "dom",
          include: domTests,
          environment: "jsdom",
          passWithNoTests: true,
        },
      },
    ],
    passWithNoTests: true,
  },
});
