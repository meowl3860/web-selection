import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  if (mode === "lib") {
    return {
      build: {
        outDir: "dist",
        emptyOutDir: false,
        sourcemap: true,
        minify: false,
        lib: { entry: here("src/index.ts"), formats: ["es"], fileName: () => "web-selection.js" },
      },
    };
  }
  if (mode === "iife") {
    // One script for the try-it extension and for pages that load it with a script tag.
    return {
      build: {
        outDir: "extension",
        emptyOutDir: false,
        minify: false,
        lib: { entry: here("src/global.ts"), formats: ["iife"], name: "WebSelectionScript", fileName: () => "web-selection.js" },
      },
    };
  }
  return {
    root: here("playground"),
    server: { port: 5199, strictPort: true },
    build: {
      outDir: here("dist-playground"),
      emptyOutDir: true,
      rollupOptions: { input: { index: here("playground/index.html"), cards: here("playground/cards.html") } },
    },
  };
});
