// The example: a brush on an article, and beside it the context a model would get for what is
// painted, in the format the controls choose. It uses the library the way any project would.
import { noteBubble } from "../demo/note-bubble.js";
import { createBrush } from "../src/index.js";
import { toContext, type AIContext, type ContextOptions, type ImageMode, type TextMode } from "../src/context/index.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = $<HTMLButtonElement>("toggle");
const controls = $<HTMLFormElement>("controls");
const output = $<HTMLDivElement>("output");
const tokens = $<HTMLParagraphElement>("tokens");
const hint = $<HTMLParagraphElement>("hint");

const brush = createBrush({ root: $("article"), size: 14 });
noteBubble(brush, { mic: true });

function options(): ContextOptions {
  const f = new FormData(controls);
  const budget = Number(f.get("budget"));
  return {
    text: f.get("text") as TextMode,
    images: f.get("images") as ImageMode,
    format: f.get("format") as "markdown" | "json",
    around: Math.max(0, Number(f.get("around")) || 0),
    ...(budget > 0 ? { budget } : {}),
  };
}

let run = 0;
async function update(): Promise<void> {
  const mine = ++run;
  const items = brush.items();
  if (!items.length) {
    output.replaceChildren();
    tokens.textContent = "Nothing selected";
    return;
  }
  const ctx = await toContext(items, options());
  if (mine === run) show(ctx);
}

function show(ctx: AIContext): void {
  tokens.textContent = `About ${ctx.tokens.toLocaleString()} tokens · ${ctx.parts.length} part${ctx.parts.length === 1 ? "" : "s"}`;
  output.replaceChildren(
    ...ctx.parts.map((p) => {
      if (p.type === "text") {
        const pre = document.createElement("pre");
        pre.textContent = p.text;
        return pre;
      }
      const fig = document.createElement("figure");
      const img = new Image(p.width, p.height);
      img.src = `data:${p.mediaType};base64,${p.data}`;
      img.alt = p.label;
      const cap = document.createElement("figcaption");
      cap.textContent = `${p.width} × ${p.height} px, about ${Math.ceil((p.width * p.height) / 750)} tokens`;
      fig.append(img, cap);
      return fig;
    }),
  );
}

function showState(): void {
  toggle.innerHTML = brush.enabled ? "Stop painting <kbd>Esc</kbd>" : "Start painting <kbd>B</kbd>";
  toggle.classList.toggle("on", brush.enabled);
  hint.textContent = brush.enabled
    ? "Paint over anything, then type or speak a note for it. Alt erases, right-click removes a stroke. Press Esc to use the controls."
    : brush.selected.length
      ? "Change the controls to see the same selection in another format."
      : "Start painting, then paint over anything on the page: words, a table cell, a line of code, a person in the picture.";
}

brush.on("end", () => void update());
brush.on("change", () => void update());
brush.on("marks", () => void update());
brush.on("enabled", showState);
controls.addEventListener("input", () => void update());
toggle.addEventListener("click", () => brush.toggle());
addEventListener("keydown", (e) => {
  const field = e.target instanceof HTMLInputElement && e.target.type === "number";
  if (!brush.enabled && !field && e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey && !e.altKey) brush.enable();
});
showState();
