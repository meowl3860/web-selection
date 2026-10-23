// Runs the test series in tests/eval/cases.mjs: paints each case in Chrome, turns the paint into
// context in every format of its kind, asks each model the case's question, and has a judge
// model grade the answers. Writes tests/eval/RESULTS.md and, for looking through every prompt
// and answer, tests/eval/results/<time>/report.html.
//
//   node tests/eval/run.mjs                   all cases, Haiku and Opus, through the claude CLI
//   node tests/eval/run.mjs --dry             only build the prompts, with no model calls
//   node tests/eval/run.mjs --cases person,chart-bar --models haiku --repeat 2
//   node tests/eval/run.mjs --backend api     the Anthropic API, with ANTHROPIC_API_KEY
//
// The CLI backend runs `claude -p` with no tools and its own system prompt, from an empty
// folder, so the answers rest on the context alone. It adds a small fixed preamble to every
// call; the token counts below take it off by measuring a call with no context.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";
import { CASES, NOTE_FORMATS, PICTURE_FORMATS, REAL_FORMATS, TEXT_FORMATS } from "./cases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BASE = "http://localhost:5199/tests/fixtures/";
const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
const JUDGE = MODELS.opus;

const args = parseArgs(process.argv.slice(2));
const models = (args.models ?? "haiku,opus").split(",").map((m) => MODELS[m] ?? m);
const cases = args.cases ? CASES.filter((c) => args.cases.split(",").includes(c.id)) : CASES;
const repeat = Number(args.repeat ?? 1);
const backend = args.backend ?? "cli";
const concurrency = Number(args.concurrency ?? 4);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join(HERE, "results", stamp);
const empty = mkdtempSync(join(tmpdir(), "ws-eval-"));

const SYSTEM =
  "You are an assistant built into a web browser. The user pointed at part of the page they are reading by painting over it with a brush, then asked a question about what they pointed at. Answer the question directly, in at most three sentences.";

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith("--")) continue;
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else out[a.slice(2)] = list[++i];
  }
  return out;
}

/* ---------- the page side ---------- */

async function serverUp() {
  try {
    return (await fetch(BASE + "article.html")).ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await serverUp()) return null;
  const child = spawn("npx vite", { cwd: ROOT, shell: true, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  return child;
}

function stopServer(child) {
  if (!child) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

/** The library as two classic scripts, so any page can take it, real sites too. */
async function libraries() {
  const dir = join(OUT, "lib");
  for (const [entry, name, file] of [["src/index.ts", "WSBrush", "brush.js"], ["src/context/index.ts", "WSContext", "context.js"]]) {
    await build({ configFile: false, logLevel: "warn", build: { outDir: dir, emptyOutDir: false, minify: false, lib: { entry: join(ROOT, entry), formats: ["iife"], name, fileName: () => file } } });
  }
  return ["brush.js", "context.js"].map((f) => readFileSync(join(dir, f), "utf8"));
}

/** Paints a case on its page and returns the context in each format of its kind. */
async function buildPrompts(browser, c, libs) {
  const real = /^https?:/.test(c.page);
  // Some sites turn away a browser that says it is headless.
  const userAgent = (await (await browser.newBrowserCDPSession()).send("Browser.getVersion")).userAgent.replace("HeadlessChrome", "Chrome");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, userAgent, bypassCSP: true });
  const page = await context.newPage();
  await page.goto(real ? c.page : BASE + c.page, { waitUntil: "load", timeout: 45000 });
  if (real) await page.waitForTimeout(1500);
  for (const code of libs) await page.evaluate(code);
  // A screenshot of part of the tab, as an extension takes one with captureVisibleTab, for
  // pictures the page may not read.
  await page.exposeFunction("tabShot", async (r) => (await page.screenshot({ clip: r, type: "png" })).toString("base64"));
  await page.evaluate(() => {
    window.brush = window.WSBrush.createBrush({ look: "none", hud: false });
    window.brush.enable();
    const shot = (el) =>
      window.brush.unmarked(async () => {
        const r = el.getBoundingClientRect();
        return "data:image/png;base64," + (await window.tabShot({ x: r.left, y: r.top, width: r.width, height: r.height }));
      });
    window.toContext = (items, o) => window.WSContext.toContext(items, { ...o, pixels: shot });
  });
  // Pictures the page loads up front; decode() on a lazy picture that is not loading can crash Chrome.
  await page.evaluate(() => Promise.all([...document.images].filter((i) => i.complete || i.loading !== "lazy").map((i) => i.decode().catch(() => {}))));
  await paint(page, c.paint);
  const formats = c.kind === "text" ? TEXT_FORMATS : c.kind === "notes" ? NOTE_FORMATS : c.kind === "real" ? REAL_FORMATS : PICTURE_FORMATS;
  const out = {};
  for (const [name, options] of Object.entries(formats)) {
    out[name] = await page.evaluate((o) => window.toContext(window.brush.items(), o), options);
  }
  const shot = join(OUT, "prompts", c.id, "page.png");
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
  await context.close();
  return out;
}

async function paint(page, how) {
  if (how.marks) {
    for (const { note, ...one } of how.marks) {
      await paint(page, one);
      await page.evaluate((text) => {
        const marks = window.brush.marks();
        window.brush.note(marks[marks.length - 1].id, text);
      }, note);
    }
    return;
  }
  const drag = async (points, size) => {
    await page.evaluate((s) => (window.brush.size = s), size);
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 8 });
    if (points.length === 1) await page.mouse.move(points[0][0] + 0.5, points[0][1]);
    await page.mouse.up();
  };
  const box = (selector) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      el.scrollIntoView({ block: "center" });
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    }, selector);
  if (how.phrase) {
    // The phrase may run across several text nodes, as highlighted code does; the first
    // element matching the selector that holds it is used.
    const [selector, text] = how.phrase;
    const rects = await page.evaluate(
      ([s, t]) => {
        for (const el of document.querySelectorAll(s)) {
          const nodes = [];
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
          const all = nodes.map((n) => n.data).join("");
          const i = all.indexOf(t);
          if (i < 0) continue;
          const at = (k) => {
            let left = k;
            for (const n of nodes) {
              if (left <= n.length) return [n, left];
              left -= n.length;
            }
            return [nodes[nodes.length - 1], nodes[nodes.length - 1].length];
          };
          const r = document.createRange();
          r.setStart(...at(i));
          r.setEnd(...at(i + t.length));
          r.startContainer.parentElement.scrollIntoView({ block: "center" });
          return [...r.getClientRects()].filter((b) => b.width > 0 && b.height > 0).map((b) => ({ x: b.left, y: b.top, w: b.width, h: b.height }));
        }
        throw new Error(`no "${t}" in ${s}`);
      },
      [selector, text],
    );
    for (const r of rects) await drag([[r.x + 2, r.y + r.h / 2], [r.x + r.w - 2, r.y + r.h / 2]], 8);
  } else if (how.touchText || how.acrossText) {
    const place = (selector, words) =>
      page.evaluate(([s, w]) => {
        const el = [...document.querySelectorAll(s)].find((e) => (e.textContent ?? "").includes(w));
        if (!el) throw new Error(`no "${w}" in ${s}`);
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }, [selector, words]);
    if (how.touchText) {
      const [selector, words] = how.touchText;
      await page.evaluate(([s, w]) => [...document.querySelectorAll(s)].find((e) => (e.textContent ?? "").includes(w))?.scrollIntoView({ block: "center" }), [selector, words]);
      const b = await place(selector, words);
      await drag([[b.x + b.w * 0.5, b.y + b.h * 0.5]], 16);
    } else {
      const [s1, w1, s2, w2] = how.acrossText;
      await page.evaluate(([s, w]) => [...document.querySelectorAll(s)].find((e) => (e.textContent ?? "").includes(w))?.scrollIntoView({ block: "start" }), [s1, w1]);
      await page.evaluate(() => scrollBy(0, -120));
      const a = await place(s1, w1);
      const b = await place(s2, w2);
      await drag([[a.x + a.w * 0.3, a.y + a.h * 0.3], [b.x + b.w * 0.6, b.y + b.h * 0.6]], 12);
    }
  } else if (how.touch) {
    const [selector, fx, fy] = how.touch;
    const b = await box(selector);
    // A touch with the brush at its starting size.
    await drag([[b.x + b.w * fx, b.y + b.h * fy]], 16);
  } else if (how.across) {
    const [a, ay, bSel, by] = how.across;
    const first = await box(a);
    const second = await page.evaluate((s) => {
      const b = document.querySelector(s).getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    }, bSel);
    await drag([[first.x + first.w * 0.3, first.y + first.h * ay], [second.x + second.w * 0.6, second.y + second.h * by]], 12);
  } else if (how.area) {
    const [selector, points, radius] = how.area;
    const b = await box(selector);
    await drag(points.map(([fx, fy]) => [b.x + b.w * fx, b.y + b.h * fy]), radius);
  } else if (how.areaByCaption) {
    // A picture found by words in its caption, for pages whose pictures have no handy selector.
    const [caption, points, radius] = how.areaByCaption;
    const b = await page.evaluate((words) => {
      const fig = [...document.querySelectorAll("figure, .thumb, .gallerybox")].find((f) => (f.textContent ?? "").includes(words));
      const img = fig?.querySelector("img");
      if (!img) throw new Error(`no picture with the caption "${words}"`);
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, caption);
    await drag(points.map(([fx, fy]) => [b.x + b.w * fx, b.y + b.h * fy]), radius);
  }
}

/** Saves a prompt's text and pictures, and returns it with file names in place of the pixels. */
function savePrompt(caseId, format, ctx) {
  const dir = join(OUT, "prompts", caseId);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const parts = ctx.parts.map((p) => {
    if (p.type === "text") return p;
    const file = `${format}-${++n}.${p.mediaType === "image/png" ? "png" : "jpg"}`;
    writeFileSync(join(dir, file), Buffer.from(p.data, "base64"));
    return { type: "image", label: p.label, file: relative(OUT, join(dir, file)).replace(/\\/g, "/"), width: p.width, height: p.height };
  });
  writeFileSync(join(dir, `${format}.json`), JSON.stringify({ tokens: ctx.tokens, parts }, null, 1));
  return parts;
}

/* ---------- the model side ---------- */

function content(ctx, question) {
  const blocks = ctx.parts.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } },
  );
  if (question) blocks.push({ type: "text", text: `Question: ${question}` });
  return blocks;
}

async function ask(model, system, blocks, effort) {
  const t0 = Date.now();
  const r = backend === "api" ? await viaApi(model, system, blocks) : await viaCli(model, system, blocks, effort);
  return { ...r, ms: r.ms ?? Date.now() - t0 };
}

function viaCli(model, system, blocks, effort) {
  return new Promise((resolve) => {
    const cliArgs = ["-p", "--model", model, "--system-prompt", system, "--tools", "", "--setting-sources", "", "--strict-mcp-config",
      "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"];
    if (effort) cliArgs.push("--effort", effort);
    const child = spawn("claude", cliArgs, { cwd: empty, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill(), 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      clearTimeout(timer);
      let text = "", usage = null, ms = null, error = null;
      for (const line of out.split("\n")) {
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (o.type === "assistant") text = o.message.content.filter((b) => b.type === "text").map((b) => b.text).join("") || text;
        if (o.type === "result") {
          if (typeof o.result === "string" && o.result) text = o.result;
          usage = o.usage;
          ms = o.duration_api_ms ?? null;
          if (o.is_error) error = o.result || "error";
        }
      }
      if (!usage && !error) error = (err || out).slice(-400) || "no result";
      const input = usage ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) : null;
      resolve({ text: text.trim(), input, output: usage?.output_tokens ?? null, ms, error });
    });
    child.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content: blocks } }) + "\n");
  });
}

async function viaApi(model, system, blocks) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: "", input: null, output: null, error: "ANTHROPIC_API_KEY is not set" };
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: "user", content: blocks }] }),
  });
  const body = await res.json();
  if (!res.ok) return { text: "", input: null, output: null, error: body?.error?.message ?? res.statusText };
  const text = body.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text: text.trim(), input: body.usage.input_tokens, output: body.usage.output_tokens, ms: Date.now() - t0, error: null };
}

async function judge(c, answer) {
  const prompt = [
    "A user painted over part of a web page to point at something, then asked a question.",
    `What the user pointed at: ${c.pointed}`,
    `The question: ${c.question}`,
    `What a correct answer says: ${c.expected}`,
    `Grading rule: ${c.rubric}`,
    "",
    "The assistant's answer:",
    '"""',
    answer,
    '"""',
    "",
    "Score 1 when the answer is correct and about what the user pointed at. Score 0.5 when it is partly right, or when it hedges between several things. Score 0 when it is wrong, refuses, asks which thing the user means, or is about something else.",
    'Reply with JSON only: {"score": 0 or 0.5 or 1, "reason": "one short sentence"}',
  ].join("\n");
  const r = await ask(JUDGE, "You grade answers from an AI assistant. Reply with JSON only.", [{ type: "text", text: prompt }], "low");
  const m = /\{[\s\S]*\}/.exec(r.text);
  try {
    const v = JSON.parse(m?.[0] ?? "");
    return { score: Number(v.score), reason: String(v.reason ?? "") };
  } catch {
    return { score: null, reason: r.error ?? `could not read the grade: ${r.text.slice(0, 200)}` };
  }
}

async function pool(tasks, n, label) {
  let next = 0, done = 0;
  const results = new Array(tasks.length);
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
        done++;
        process.stdout.write(`\r${label}: ${done}/${tasks.length}   `);
      }
    }),
  );
  process.stdout.write("\n");
  return results;
}

/* ---------- reporting ---------- */

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const short = (m) => Object.entries(MODELS).find(([, id]) => id === m)?.[0] ?? m;
const fmt = (v, d = 2) => (v === null ? "-" : v.toFixed(d));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function summarize(runs) {
  const kinds = { text: Object.keys(TEXT_FORMATS), picture: Object.keys(PICTURE_FORMATS), notes: Object.keys(NOTE_FORMATS), real: Object.keys(REAL_FORMATS) };
  const out = {};
  for (const [kind, formats] of Object.entries(kinds)) {
    const rows = [];
    for (const f of formats) {
      const mine = runs.filter((r) => r.kind === kind && r.format === f);
      if (!mine.length) continue;
      const row = { format: f, estimate: mean(mine.map((r) => r.estimate)) };
      for (const m of models) {
        const rs = mine.filter((r) => r.model === m);
        row[m] = { score: mean(rs.map((r) => r.score)), tokens: mean(rs.map((r) => r.contextTokens)), ms: mean(rs.map((r) => r.ms)) };
      }
      rows.push(row);
    }
    out[kind] = rows;
  }
  return out;
}

function writeMarkdown(runs, summary, baseline) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "# Test series results",
    "",
    "<!-- Written by tests/eval/run.mjs. Run it again rather than editing this file. -->",
    "",
    `Run on ${date} with ${models.join(" and ")} answering and ${JUDGE} grading, through the ${backend === "api" ? "Anthropic API" : "claude CLI"}.`,
    `${cases.length} cases, ${repeat} run${repeat > 1 ? "s" : ""} each, ${runs.length} answers.`,
    "A score is the mean grade: 1 for a correct answer about what the user pointed at, 0.5 for a partly right one, 0 for a wrong one.",
    "Tokens are the input tokens the context took, measured by the model, without the question and the fixed preamble.",
    "",
  ];
  for (const [kind, rows] of Object.entries(summary)) {
    if (!rows.length) continue;
    lines.push(`## ${{ text: "Text", picture: "Pictures", notes: "Notes on marks", real: "Real sites" }[kind]}`, "");
    const head = ["Format", ...models.map((m) => `${short(m)} score`), ...models.map((m) => `${short(m)} tokens`), "Estimated tokens", ...models.map((m) => `${short(m)} seconds`)];
    lines.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
    for (const r of rows) {
      lines.push(`| ${[r.format, ...models.map((m) => fmt(r[m].score)), ...models.map((m) => fmt(r[m].tokens, 0)), fmt(r.estimate, 0), ...models.map((m) => fmt(r[m].ms === null ? null : r[m].ms / 1000, 1))].join(" | ")} |`);
    }
    lines.push("");
  }
  lines.push("## Each case", "");
  for (const c of cases) {
    const mine = runs.filter((r) => r.case === c.id);
    const formats = [...new Set(mine.map((r) => r.format))];
    lines.push(`### ${c.id}`, "", `${c.question} (${c.pointed})`, "");
    lines.push(`| Format | ${models.map(short).join(" | ")} |`, `|---|${models.map(() => "---").join("|")}|`);
    for (const f of formats) lines.push(`| ${f} | ${models.map((m) => mine.filter((r) => r.format === f && r.model === m).map((r) => (r.score ?? "?")).join(", ")).join(" | ")} |`);
    lines.push("");
  }
  lines.push(`Fixed preamble measured per model: ${models.map((m) => `${short(m)} ${baseline[m] ?? "-"}`).join(", ")} tokens.`, "");
  writeFileSync(join(HERE, "RESULTS.md"), lines.join("\n"));
}

function writeHtml(runs, summary, prompts) {
  const table = (rows) => {
    const head = ["Format", ...models.map((m) => `${short(m)} score`), ...models.map((m) => `${short(m)} tokens`), ...models.map((m) => `${short(m)} s`)];
    return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr><td>${esc(r.format)}</td>${models.map((m) => `<td class="num ${score(r[m].score)}">${fmt(r[m].score)}</td>`).join("")}${models.map((m) => `<td class="num">${fmt(r[m].tokens, 0)}</td>`).join("")}${models.map((m) => `<td class="num">${fmt(r[m].ms === null ? null : r[m].ms / 1000, 1)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  };
  const score = (s) => (s === null ? "" : s >= 0.9 ? "good" : s >= 0.5 ? "mid" : "bad");
  const sections = cases
    .map((c) => {
      const fmts = Object.keys(prompts[c.id] ?? {});
      return `<section><h2>${esc(c.id)}</h2><p class="q"><b>${esc(c.question)}</b> ${esc(c.pointed)}</p><p class="exp">Correct: ${esc(c.expected)}</p>
      <img class="shot" src="prompts/${esc(c.id)}/page.png" alt="">
      ${fmts
        .map((f) => {
          const parts = prompts[c.id][f];
          const rs = runs.filter((r) => r.case === c.id && r.format === f);
          return `<details><summary><span class="f">${esc(f)}</span>${rs.map((r) => `<span class="pill ${score(r.score)}">${esc(short(r.model))} ${r.score ?? "?"}</span>`).join("")}</summary>
          <div class="prompt">${parts.map((p) => (p.type === "text" ? `<pre>${esc(p.text)}</pre>` : `<img src="${esc(p.file)}" alt="${esc(p.label)}" width="${p.width}">`)).join("")}</div>
          ${rs.map((r) => `<div class="answer"><b>${esc(short(r.model))}</b> <span class="pill ${score(r.score)}">${r.score ?? "?"}</span> ${esc(r.answer || r.error || "")}<div class="why">${esc(r.reason ?? "")}</div></div>`).join("")}</details>`;
        })
        .join("")}</section>`;
    })
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test series results</title>
<style>
:root { --bg: #f7f7fa; --fg: #1d2233; --muted: #5b6178; --card: #fff; --line: #e1e3ec; --good: #1f8a4c; --mid: #b7791f; --bad: #c53030; }
@media (prefers-color-scheme: dark) { :root { --bg: #14161f; --fg: #e8eaf2; --muted: #a0a6bd; --card: #1d2030; --line: #2c3045; --good: #4cc27f; --mid: #e0a93f; --bad: #f07070; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; }
p { margin: 4px 0; } .muted, .exp, .why { color: var(--muted); }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); margin: 8px 0 16px; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; } td.num { text-align: right; font-variant-numeric: tabular-nums; }
.good { color: var(--good); font-weight: 600; } .mid { color: var(--mid); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 16px 12px; margin: 16px 0; }
.shot { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin: 8px 0; }
details { border-top: 1px solid var(--line); padding: 6px 0; } summary { cursor: pointer; } .f { display: inline-block; min-width: 120px; font-weight: 600; }
.pill { display: inline-block; margin-left: 8px; font-size: 13px; }
.prompt pre { white-space: pre-wrap; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 10px; font: 12.5px/1.45 Consolas, monospace; }
.prompt img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 4px; }
.answer { margin: 8px 0; } .why { font-size: 13px; }
</style></head><body><main>
<h1>Test series results</h1>
<p class="muted">${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} · ${esc(models.join(", "))} answering · ${esc(JUDGE)} grading · ${esc(backend)} · ${runs.length} answers</p>
${summary.text?.length ? `<h2>Text</h2>${table(summary.text)}` : ""}
${summary.picture?.length ? `<h2>Pictures</h2>${table(summary.picture)}` : ""}
${summary.notes?.length ? `<h2>Notes on marks</h2>${table(summary.notes)}` : ""}
${summary.real?.length ? `<h2>Real sites</h2>${table(summary.real)}` : ""}
${sections}
</main></body></html>`;
  writeFileSync(join(OUT, "report.html"), html);
}

/* ---------- the run ---------- */

const server = await startServer();
const libs = await libraries();
const browser = await chromium.launch({ channel: "chrome" });
const prompts = {};
const contexts = {};
try {
  for (const c of cases) {
    // A page can time out while the dev server is busy; one more try is enough.
    const out = await buildPrompts(browser, c, libs).catch((err) => {
      console.warn(`${c.id}: ${err.message.split("\n")[0]}; trying again`);
      return buildPrompts(browser, c, libs);
    });
    contexts[c.id] = out;
    prompts[c.id] = Object.fromEntries(Object.entries(out).map(([f, ctx]) => [f, savePrompt(c.id, f, ctx)]));
    console.log(`${c.id}: ${Object.entries(out).map(([f, ctx]) => `${f} ${ctx.tokens}`).join(", ")}`);
  }
} finally {
  await browser.close();
  stopServer(server);
}

const runs = [];
const baseline = {};
if (!args.dry) {
  const base = await pool(models.map((m) => () => ask(m, SYSTEM, [{ type: "text", text: "Question: Reply with the word OK." }])), concurrency, "preamble");
  models.forEach((m, i) => (baseline[m] = base[i].input));
  const tasks = [];
  for (const c of cases) {
    for (const [format, ctx] of Object.entries(contexts[c.id])) {
      for (const model of models) {
        for (let k = 0; k < repeat; k++) {
          tasks.push(async () => {
            const a = await ask(model, SYSTEM, content(ctx, c.question));
            const g = a.error ? { score: null, reason: a.error } : await judge(c, a.text);
            const q = Math.ceil(`Question: ${c.question}`.length / 4);
            return { case: c.id, kind: c.kind, format, model, estimate: ctx.tokens, contextTokens: a.input === null || baseline[model] == null ? null : a.input - baseline[model] - q, ms: a.ms, answer: a.text, error: a.error, ...g };
          });
        }
      }
    }
  }
  runs.push(...(await pool(tasks, concurrency, "answers")));
} else {
  for (const c of cases) for (const [format, ctx] of Object.entries(contexts[c.id])) runs.push({ case: c.id, kind: c.kind, format, model: null, estimate: ctx.tokens });
}
writeFileSync(join(OUT, "results.json"), JSON.stringify({ models, judge: JUDGE, backend, repeat, baseline, runs }, null, 1));
const summary = summarize(runs);
writeHtml(runs, summary, prompts);
if (!args.dry && !args.cases) writeMarkdown(runs, summary, baseline);
console.log(`Report: ${join(OUT, "report.html")}`);
