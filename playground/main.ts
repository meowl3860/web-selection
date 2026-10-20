import { createWebSelection } from "../src/index.js";

const ws = createWebSelection({ exclude: (el) => el.hasAttribute("data-playground-ui") });
(window as unknown as { ws: typeof ws }).ws = ws;

const output = document.getElementById("output")!;
const toggle = document.getElementById("toggle")!;

ws.on("change", (sel) => {
  output.textContent = sel.isEmpty ? "Nothing selected yet." : sel.text();
});
ws.on("enabled", (on) => {
  toggle.firstChild!.textContent = on ? "Tools off " : "Tools on ";
});
toggle.addEventListener("click", () => ws.toggle());
document.addEventListener("keydown", (e) => {
  if (!ws.enabled && e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) ws.enable();
});

ws.enable();
