import { createWebSelection } from "../src/index.js";

const ws = createWebSelection({ exclude: (el) => el.hasAttribute("data-playground-ui") });
(window as unknown as { ws: typeof ws }).ws = ws;

const output = document.getElementById("output")!;
const toggle = document.getElementById("toggle")!;

ws.on("change", (sel) => {
  if (sel.isEmpty) {
    output.textContent = "Nothing selected yet.";
    return;
  }
  const { titles } = sel.context();
  output.textContent = (titles.length ? `Under: ${titles.join(" > ")}\n\n` : "") + sel.text();
});
ws.on("enabled", (on) => {
  toggle.firstChild!.textContent = on ? "Tools off " : "Tools on ";
});
toggle.addEventListener("click", () => ws.toggle());
document.addEventListener("keydown", (e) => {
  if (!ws.enabled && e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) ws.enable();
});

ws.enable();
