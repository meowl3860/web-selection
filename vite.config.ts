import { defineConfig } from "vite";

// Serves the repo: the example at /examples/ and the test pages at /tests/fixtures/.
// The library and the extension are built by scripts/build.mjs. Pages never reload by
// themselves: a reload in the middle of a test would break it, so after an edit, reload the
// example by hand. Build and test output is not watched either.
export default defineConfig({
  server: {
    port: 5199,
    strictPort: true,
    hmr: false,
    watch: { ignored: ["**/dist/**", "**/extension/*.js", "**/test-results/**", "**/playwright-report/**", "**/shots/**", "**/real-shots/**", "**/tests/eval/results/**"] },
  },
});
