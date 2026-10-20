// The built-in tool bar, modelled on Photoshop's tools panel and options bar: tools, the four
// selection modes and the current tool's options on top; the Select menu commands, the view
// and the selection count below. It can be dragged anywhere by its grip.

import type { Mode } from "../core/intervals.js";
import type { SelectionSnapshot } from "../core/snapshot.js";
import type { Tool } from "./cursors.js";

interface Settings {
  tool: Tool;
  mode: Mode;
  reach: "part" | "section";
  tolerance: number;
  contiguous: boolean;
  wholeBlocks: boolean;
  brushSize: number;
  brushBlocks: boolean;
  view: "ants" | "mask";
}

type Command = "selectAll" | "deselect" | "reselect" | "invert" | "grow" | "similar" | "expand" | "contract" | "mainText" | "undo" | "redo";

export interface PaletteHost {
  readonly settings: Readonly<Settings>;
  readonly selection: SelectionSnapshot;
  set(patch: Partial<Settings>): void;
  run(command: Command): void;
  disable(): void;
}

const ICONS: Record<string, string> = {
  smart: '<path d="M3.5 3.5h3M9 3.5h2.5M14 3.5h2.5v2.5M16.5 8.5V11M3.5 6v2.5M3.5 11v2.5h2.5" stroke-width="1.4"/><path d="M8.5 8.5v8.6l2.3-2.2 1.6 3.4 1.5-.7-1.6-3.3 3.2-.2z" fill="currentColor" stroke-width="1.1"/>',
  wand: '<path d="M3.5 16.5l9.2-9.2" /><path d="M11.4 6.2l2.4 2.4" /><path d="M15.2 1.9l.75 1.65 1.65.75-1.65.75-.75 1.65-.75-1.65-1.65-.75 1.65-.75z" fill="currentColor" stroke-width="1"/><path d="M17.6 9.3v2M16.6 10.3h2M8.6 2.4v1.6M7.8 3.2h1.6" stroke-width="1.2"/>',
  marquee: '<rect x="3.25" y="4.25" width="13.5" height="11.5" rx="1" stroke-dasharray="2.4 2.1" />',
  lasso: '<path d="M7.2 13.4C4.4 12.8 2.8 11.3 2.8 9.3c0-2.8 3.3-4.9 7.4-4.9s7.4 2.1 7.4 4.9-3.3 4.3-7.4 4.3c-1.1 0-2.1-.1-3-.2z" /><path d="M7.2 13.4c-.3 1.5-1.1 2.9-2.6 4.1" /><circle cx="7.3" cy="13.4" r="1.1" fill="currentColor" stroke="none"/>',
  brush: '<path d="M16.8 3.2c.6.6.4 1.8-.5 2.7l-6.1 6.4-2.5-2.5 6.4-6.1c.9-.9 2.1-1.1 2.7-.5z" /><path d="M7.4 10.1l2.5 2.5c-.3 2.4-2.2 4.2-5.9 4.1.9-1 .9-2 .9-3 0-1.9 1.1-3.4 2.5-3.6z" />',
  text: '<path d="M7 3.5h6M10 3.5v13M7 16.5h6" />',
  grip: '<circle cx="2" cy="3" r="1.1"/><circle cx="6" cy="3" r="1.1"/><circle cx="2" cy="8" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="2" cy="13" r="1.1"/><circle cx="6" cy="13" r="1.1"/>',
  new: '<rect x="3" y="3" width="10" height="10" rx="0.5" fill="currentColor" fill-opacity="0.18"/>',
  add: '<path d="M2 2h7.5v4.5H14V14H6.5V9.5H2z" fill="currentColor" fill-opacity="0.18"/>',
  subtract: '<path d="M2 2h7.5v4.5h-3v3H2z" fill="currentColor" fill-opacity="0.18"/><path d="M6.5 6.5H14V14H6.5z" stroke-dasharray="1.6 1.4" stroke-width="1.1"/>',
  intersect: '<path d="M2 2h7.5v7.5H2zM6.5 6.5H14V14H6.5z" stroke-width="1.1" stroke-dasharray="1.6 1.4"/><path d="M6.5 6.5h3v3h-3z" fill="currentColor" stroke="currentColor"/>',
};

function svg(name: string): string {
  if (name === "grip") return `<svg viewBox="0 0 8 16" fill="currentColor" aria-hidden="true">${ICONS.grip}</svg>`;
  const box = name in MODE_LABEL ? "0 0 16 16" : "0 0 20 20";
  return `<svg viewBox="${box}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const TOOL_INFO: Record<Tool, { label: string; key: string; help: string }> = {
  smart: { label: "Smart select", key: "S", help: "Point at any part to see what belongs with it, then click. Click inside the selection to take its whole section." },
  wand: { label: "Magic wand", key: "W", help: "Click a block to select the blocks that look like it." },
  marquee: { label: "Marquee", key: "M", help: "Drag a box to select the text inside it." },
  lasso: { label: "Lasso", key: "L", help: "Draw around the text you want." },
  brush: { label: "Brush", key: "B", help: "Paint over blocks to select them whole." },
  text: { label: "Text", key: "T", help: "Drag across text, as in a normal selection. Double-click selects a word." },
};

const MODE_LABEL: Record<Mode, { label: string; key: string }> = {
  new: { label: "New selection", key: "" },
  add: { label: "Add to selection", key: "Shift" },
  subtract: { label: "Subtract from selection", key: "Alt" },
  intersect: { label: "Intersect with selection", key: "Shift+Alt" },
};

const COMMANDS: { cmd: Command; label: string; help: string; key?: string }[] = [
  { cmd: "mainText", label: "Main text", help: "Select the page's main text, like Select Subject." },
  { cmd: "grow", label: "Grow", help: "Add the blocks next to the selection that look alike." },
  { cmd: "similar", label: "Similar", help: "Add every block on the page that looks alike." },
  { cmd: "invert", label: "Invert", help: "Select everything else.", key: "Ctrl+I" },
  { cmd: "deselect", label: "Deselect", help: "Clear the selection.", key: "Ctrl+D" },
];

export class Palette {
  private readonly bar: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly modeButtons = new Map<Mode, HTMLButtonElement>();
  private readonly viewButtons = new Map<string, HTMLButtonElement>();
  private readonly opts: Record<"smart" | "wand" | "shape" | "brush" | "text", HTMLDivElement>;
  private readonly tolerance: HTMLInputElement;
  private readonly toleranceNum: HTMLSpanElement;
  private readonly contiguous: HTMLInputElement;
  private readonly whole: HTMLInputElement;
  private readonly size: HTMLInputElement;
  private readonly brushWhole: HTMLInputElement;
  private readonly sizeNum: HTMLSpanElement;
  private readonly status: HTMLSpanElement;
  private readonly reachButtons = new Map<string, HTMLButtonElement>();
  private readonly deselect: HTMLButtonElement;
  private tipTimer = 0;

  constructor(private readonly ui: HTMLElement, private readonly host: PaletteHost) {
    const doc = ui.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html) e.innerHTML = html;
      return e;
    };
    const button = (cls: string, html: string, label: string, onClick: () => void, tip?: { label: string; key?: string; help?: string }) => {
      const b = el("button", cls, html);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      if (tip) this.tipFor(b, tip);
      return b;
    };

    this.bar = el("div", "bar");
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", "Selection tools");
    this.bar.hidden = true;
    const top = el("div", "row");
    const bottom = el("div", "row");
    this.bar.append(top, bottom);

    const grip = button("grip", svg("grip"), "Move the tool bar", () => {});
    grip.tabIndex = -1;
    this.dragWith(grip);

    const tools = el("div", "group tools");
    for (const t of Object.keys(TOOL_INFO) as Tool[]) {
      const info = TOOL_INFO[t];
      const b = button("icon", svg(t), info.label, () => host.set({ tool: t }), info);
      this.toolButtons.set(t, b);
      tools.append(b);
    }

    const modes = el("div", "group modes");
    for (const m of Object.keys(MODE_LABEL) as Mode[]) {
      const info = MODE_LABEL[m];
      const b = button("icon", svg(m), info.label, () => host.set({ mode: m }), { label: info.label, key: info.key || undefined });
      this.modeButtons.set(m, b);
      modes.append(b);
    }

    // Options for the current tool, as in Photoshop's options bar.
    const smartOpts = el("div", "opts");
    const reach = el("div", "seg");
    for (const [v, label, help] of [
      ["part", "Part", "The part under the pointer with what belongs to it: a list with its lead-in, a picture with its caption, a card."],
      ["section", "Section", "The whole section under the nearest title."],
    ] as const) {
      const b = button("", label, `Takes ${label.toLowerCase()}`, () => host.set({ reach: v }), { label, help });
      this.reachButtons.set(v, b);
      reach.append(b);
    }
    smartOpts.append(el("span", "opt-label", "Takes"), reach);

    const wandOpts = el("div", "opts");
    const tolLabel = el("span", "opt-label", "Tolerance");
    this.tolerance = el("input");
    this.tolerance.type = "range";
    this.tolerance.min = "0";
    this.tolerance.max = "100";
    this.tolerance.step = "1";
    this.tolerance.setAttribute("aria-label", "Tolerance");
    this.tolerance.addEventListener("input", () => host.set({ tolerance: +this.tolerance.value }));
    this.tipFor(this.tolerance, { label: "Tolerance", key: "[ ]", help: "How alike blocks must look. Low takes one kind of block; high takes more." });
    this.toleranceNum = el("span", "num");
    const contig = el("label", "check");
    this.contiguous = el("input");
    this.contiguous.type = "checkbox";
    this.contiguous.addEventListener("change", () => host.set({ contiguous: this.contiguous.checked }));
    contig.append(this.contiguous, doc.createTextNode("Contiguous"));
    this.tipFor(contig, { label: "Contiguous", help: "On: only the run around the click. Off: alike blocks anywhere on the page." });
    wandOpts.append(tolLabel, this.tolerance, this.toleranceNum, contig);

    const shapeOpts = el("div", "opts");
    const whole = el("label", "check");
    this.whole = el("input");
    this.whole.type = "checkbox";
    this.whole.addEventListener("change", () => host.set({ wholeBlocks: this.whole.checked }));
    whole.append(this.whole, doc.createTextNode("Whole blocks"));
    this.tipFor(whole, { label: "Whole blocks", help: "Take each block the shape touches, not only the characters inside it." });
    shapeOpts.append(whole);

    const brushOpts = el("div", "opts");
    this.size = el("input");
    this.size.type = "range";
    this.size.min = "3";
    this.size.max = "80";
    this.size.step = "1";
    this.size.setAttribute("aria-label", "Brush size");
    this.size.addEventListener("input", () => host.set({ brushSize: +this.size.value }));
    this.tipFor(this.size, { label: "Brush size", key: "[ ]" });
    this.sizeNum = el("span", "num");
    const brushWhole = el("label", "check");
    this.brushWhole = el("input");
    this.brushWhole.type = "checkbox";
    this.brushWhole.addEventListener("change", () => host.set({ brushBlocks: this.brushWhole.checked }));
    brushWhole.append(this.brushWhole, doc.createTextNode("Whole blocks"));
    this.tipFor(brushWhole, { label: "Whole blocks", help: "On: each block the brush touches, like Quick Selection. Off: only the characters under the brush, like painting a mask." });
    brushOpts.append(el("span", "opt-label", "Size"), this.size, this.sizeNum, brushWhole);

    const textOpts = el("div", "opts", '<span class="hint">Drag across text. Double-click a word, triple-click a block.</span>');
    this.opts = { smart: smartOpts, wand: wandOpts, shape: shapeOpts, brush: brushOpts, text: textOpts };

    top.append(grip, tools, el("div", "sep"), modes, el("div", "sep"), smartOpts, wandOpts, shapeOpts, brushOpts, textOpts);

    const cmds = el("div", "group cmds");
    const commandButtons = COMMANDS.map((c) => {
      const b = button("", c.label, c.label, () => host.run(c.cmd), { label: c.label, key: c.key, help: c.help });
      cmds.append(b);
      return b;
    });
    this.deselect = commandButtons[COMMANDS.findIndex((c) => c.cmd === "deselect")]!;

    const view = el("div", "seg");
    for (const [v, label, help] of [
      ["ants", "Ants", "Outline the selection with marching ants."],
      ["mask", "Mask", "Tint everything outside the selection, like Quick Mask."],
    ] as const) {
      const b = button("", label, label, () => host.set({ view: v }), { label: `${label} view`, key: "Q", help });
      this.viewButtons.set(v, b);
      view.append(b);
    }

    this.status = el("span", "status");
    this.status.setAttribute("aria-live", "polite");
    const done = button("done", "Done", "Done", () => host.disable(), { label: "Done", key: "Esc", help: "Put the tools away. The selection stays." });
    bottom.append(cmds, el("div", "sep"), view, el("div", "spacer"), this.status, done);

    this.tip = el("div", "tip");
    this.tip.hidden = true;
    this.tip.setAttribute("role", "tooltip");
    ui.append(this.bar, this.tip);
    ui.ownerDocument.defaultView?.addEventListener("resize", () => this.keepInView());
  }

  show(on: boolean): void {
    this.bar.hidden = !on;
    if (!on) this.hideTip();
    else this.keepInView();
  }

  update(): void {
    const s = this.host.settings;
    for (const [t, b] of this.toolButtons) b.setAttribute("aria-pressed", String(t === s.tool));
    for (const [m, b] of this.modeButtons) b.setAttribute("aria-pressed", String(m === s.mode));
    for (const [v, b] of this.viewButtons) b.setAttribute("aria-pressed", String(v === s.view));
    for (const [v, b] of this.reachButtons) b.setAttribute("aria-pressed", String(v === s.reach));
    this.opts.smart.hidden = s.tool !== "smart";
    this.opts.wand.hidden = s.tool !== "wand";
    this.opts.shape.hidden = s.tool !== "marquee" && s.tool !== "lasso";
    this.opts.brush.hidden = s.tool !== "brush";
    this.opts.text.hidden = s.tool !== "text";
    if (this.tolerance.value !== String(s.tolerance)) this.tolerance.value = String(s.tolerance);
    this.tolerance.style.setProperty("--fill", `${s.tolerance}%`);
    this.toleranceNum.textContent = String(s.tolerance);
    this.contiguous.checked = s.contiguous;
    this.whole.checked = s.wholeBlocks;
    if (this.size.value !== String(s.brushSize)) this.size.value = String(s.brushSize);
    this.size.style.setProperty("--fill", `${((s.brushSize - 3) / 77) * 100}%`);
    this.sizeNum.textContent = String(s.brushSize);
    this.brushWhole.checked = s.brushBlocks;
    const sel = this.host.selection;
    this.deselect.disabled = sel.isEmpty;
    this.status.textContent = describe(sel);
  }

  private tipFor(target: HTMLElement, info: { label: string; key?: string; help?: string }): void {
    const show = () => {
      clearTimeout(this.tipTimer);
      this.tipTimer = window.setTimeout(() => this.showTip(target, info), 450);
    };
    target.addEventListener("pointerenter", show);
    target.addEventListener("focus", () => {
      if (target.matches(":focus-visible")) show();
    });
    for (const type of ["pointerleave", "blur", "pointerdown"]) target.addEventListener(type, () => this.hideTip());
  }

  private showTip(target: HTMLElement, info: { label: string; key?: string; help?: string }): void {
    const tip = this.tip;
    tip.innerHTML = "";
    const b = tip.ownerDocument.createElement("b");
    b.textContent = info.label;
    tip.append(b);
    if (info.key) {
      const k = tip.ownerDocument.createElement("kbd");
      k.textContent = info.key;
      tip.append(k);
    }
    if (info.help) {
      const s = tip.ownerDocument.createElement("span");
      s.textContent = info.help;
      tip.append(s);
    }
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const bar = this.bar.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = tip.ownerDocument.documentElement.clientWidth;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(vw - w - 8, left));
    // Above the bar when there is room, else below it.
    let top = bar.top - h - 8;
    if (top < 8) top = bar.bottom + 8;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  private hideTip(): void {
    clearTimeout(this.tipTimer);
    this.tip.hidden = true;
  }

  private dragWith(grip: HTMLElement): void {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const r = this.bar.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      this.place(r.left, r.top);
    });
    grip.addEventListener("pointermove", (e) => {
      if (!start) return;
      this.place(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
    });
    const end = () => (start = null);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  private place(left: number, top: number): void {
    const de = this.bar.ownerDocument.documentElement;
    const w = this.bar.offsetWidth;
    const h = this.bar.offsetHeight;
    const x = Math.max(8, Math.min(de.clientWidth - w - 8, left));
    const y = Math.max(8, Math.min(de.clientHeight - h - 8, top));
    this.bar.classList.add("placed");
    this.bar.style.left = `${Math.round(x)}px`;
    this.bar.style.top = `${Math.round(y)}px`;
  }

  private keepInView(): void {
    if (!this.bar.classList.contains("placed") || this.bar.hidden) return;
    const r = this.bar.getBoundingClientRect();
    this.place(r.left, r.top);
  }
}

function describe(sel: SelectionSnapshot): string {
  if (sel.isEmpty) return "Nothing selected";
  const s = sel.stats;
  const parts = [`${s.blocks} ${s.blocks === 1 ? "block" : "blocks"}`];
  if (s.words) parts.push(`${s.words.toLocaleString()} ${s.words === 1 ? "word" : "words"}`);
  if (s.pictures) parts.push(`${s.pictures} ${s.pictures === 1 ? "picture" : "pictures"}`);
  return parts.join(" · ");
}
