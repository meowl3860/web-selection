import { createWebSelection } from "../src/index.js";

const ws = createWebSelection();
(window as unknown as { ws: typeof ws }).ws = ws;
document.addEventListener("keydown", (e) => {
  if (!ws.enabled && e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) ws.enable();
});
ws.enable();
