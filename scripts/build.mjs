// Builds the library into dist/ (ES modules and type declarations) and the extension's two
// scripts into extension/: the brush (content.js) and the panel (popup.js), each one classic
// script. Pass --watch to rebuild the extension on each change.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { build } from "vite";

const watch = process.argv.includes("--watch");

const extension = (file, name, out) => ({
  configFile: false,
  logLevel: "warn",
  build: {
    outDir: "extension",
    emptyOutDir: false,
    minify: false,
    watch: watch ? {} : null,
    lib: { entry: file, formats: ["iife"], name, fileName: () => out },
  },
});

if (!watch) {
  rmSync("dist", { recursive: true, force: true });
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      outDir: "dist",
      minify: false,
      sourcemap: true,
      lib: { entry: { index: "src/index.ts", context: "src/context/index.ts" }, formats: ["es"], fileName: (_format, name) => `${name}.js` },
    },
  });
  const tsc = spawnSync("npx tsc -p tsconfig.build.json", { stdio: "inherit", shell: true });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);
}
await build(extension("extension/src/content.ts", "WebSelectionBrush", "content.js"));
await build(extension("extension/src/popup.ts", "WebSelectionPopup", "popup.js"));
console.log(watch ? "Watching for changes." : "Built dist/ and the extension.");
