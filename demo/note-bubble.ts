// A note box for the brush, used by the example and the extension; it is not part of the
// library. After each stroke it opens beside the stroke's end with the mark's number. Typing a
// letter starts the note, so the brush's own keys keep working; Enter or a new stroke keeps
// the note, and Escape puts back what was there. With `mic`, a button fills the note from
// speech through the browser's own speech recognition: in Chrome the audio goes to Google, in
// Edge to Microsoft.

import type { Brush } from "../src/index.js";

export interface NoteBubbleOptions {
  /** Show a microphone button where the browser can turn speech into text. */
  mic?: boolean;
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const CSS = `
:host { all: initial; position: fixed; z-index: 2147483647; left: 0; top: 0; }
.box {
  position: fixed;
  width: 300px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 10px;
  border-radius: 12px;
  background: rgba(23, 26, 44, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 28px rgba(10, 12, 24, 0.3);
  color: #f2f3fa;
  font: 400 13px/1.35 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.box[hidden] { display: none; }
.n {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ws-paint, #4b57f0);
  box-shadow: 0 0 0 2px #fff;
  font-weight: 700;
  font-size: 11px;
}
input {
  min-width: 0;
  border: 0;
  outline: 0;
  padding: 5px 2px;
  background: transparent;
  color: inherit;
  font: inherit;
}
input::placeholder { color: #a9aecb; }
.mic {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
  color: #f2f3fa;
  cursor: pointer;
}
.mic:hover { background: rgba(255, 255, 255, 0.16); }
.mic:focus-visible { outline: 2px solid #8f99ff; outline-offset: 2px; }
.mic[hidden] { display: none; }
.mic.on { background: #e5533d; }
.hint { grid-column: 1 / -1; margin: -2px 0 0 28px; color: #a9aecb; font-size: 11.5px; }
`;

const MIC_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export function noteBubble(brush: Brush, options: NoteBubbleOptions = {}): { destroy(): void } {
  const doc = document;
  const host = doc.createElement("web-selection-note");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${CSS}</style>
    <div class="box" hidden role="dialog" aria-label="Note for this mark">
      <span class="n"></span>
      <input type="text" placeholder="Type a note: what should happen here?" aria-label="Note">
      <button class="mic" type="button" title="Speak the note" aria-label="Speak the note" hidden>${MIC_ICON}</button>
      <p class="hint">Type to write · Enter keeps it · Esc undoes</p>
    </div>`;
  const box = shadow.querySelector<HTMLDivElement>(".box")!;
  const badge = shadow.querySelector<HTMLSpanElement>(".n")!;
  const input = shadow.querySelector<HTMLInputElement>("input")!;
  const mic = shadow.querySelector<HTMLButtonElement>(".mic")!;
  const hint = shadow.querySelector<HTMLParagraphElement>(".hint")!;
  const Speech = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  mic.hidden = !(options.mic && Speech);
  if (!mic.hidden) hint.textContent = "Type or speak · Enter keeps it · Esc undoes";

  let mark: number | null = null;
  let before = "";
  let rec: Recognition | null = null;

  const place = (x: number, y: number) => {
    const w = 300, h = box.offsetHeight || 64, gap = 14, edge = 8;
    const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    let left = x + gap, top = y + gap;
    if (left + w > vw - edge) left = Math.max(edge, x - gap - w);
    if (top + h > vh - edge) top = Math.max(edge, y - gap - h);
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };

  const open = (id: number, point: [number, number]) => {
    const m = brush.marks().find((x) => x.id === id);
    if (!m) return;
    if (!host.isConnected) doc.documentElement.append(host);
    mark = id;
    before = m.note;
    badge.textContent = String(m.n);
    input.value = m.note;
    box.hidden = false;
    place(point[0], point[1]);
  };

  const close = () => {
    rec?.stop();
    box.hidden = true;
    mark = null;
    if (shadow.activeElement) input.blur();
  };

  // The note is kept as it is typed, so a stroke started before Enter still begins a new mark.
  const keep = () => {
    if (mark !== null) brush.note(mark, input.value);
  };

  input.addEventListener("input", keep);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      keep();
      close();
    } else if (e.key === "Escape") {
      if (mark !== null) brush.note(mark, before);
      close();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  mic.addEventListener("click", () => {
    if (rec) {
      rec.stop();
      return;
    }
    if (!Speech || mark === null) return;
    const r = new Speech();
    r.lang = doc.documentElement.lang || navigator.language;
    r.interimResults = true;
    r.continuous = false;
    const start = input.value ? input.value.replace(/\s*$/, " ") : "";
    r.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i]![0]!.transcript;
      input.value = start + said;
      keep();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") hint.textContent = "The microphone is blocked on this page.";
    };
    r.onend = () => {
      rec = null;
      mic.classList.remove("on");
      mic.setAttribute("aria-pressed", "false");
    };
    rec = r;
    mic.classList.add("on");
    mic.setAttribute("aria-pressed", "true");
    r.start();
  });

  // A letter typed after a stroke starts the note. The brush has already taken its own keys.
  const onKey = (e: KeyboardEvent) => {
    if (box.hidden || shadow.activeElement || !brush.enabled) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  addEventListener("keydown", onKey, true);

  const offs = [
    brush.on("end", (e) => {
      if (e.cancelled || e.erase) return;
      open(e.mark, e.point);
    }),
    brush.on("start", () => {
      if (!box.hidden) close();
    }),
    brush.on("marks", (marks) => {
      if (mark !== null && !marks.some((m) => m.id === mark)) close();
    }),
    brush.on("enabled", (on) => {
      if (!on) close();
    }),
  ];

  return {
    destroy() {
      close();
      offs.forEach((off) => off());
      removeEventListener("keydown", onKey, true);
      host.remove();
    },
  };
}
