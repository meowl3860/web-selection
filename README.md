# Web Selection

Paint to select.
A zero-dependency brush that picks parts of any web page, and turns them into context an AI model can read.

- Turn the brush on, and the page is a canvas.
  Every element the paint covers is selected: paragraphs, headings, list items, table cells, code, pictures, buttons.
- It knows exactly what was painted: the words under the paint, and the place on a picture.
- `toContext()` turns the selection into Markdown or JSON for a model, with the painted words marked, where on the page they are, the text around them, and pictures with the paint drawn on them.
- A note on a mark says what the user wants there, such as "remove this person": each mark is numbered, and the notes go to the model with their numbers.
- It works on any existing page, also pages built from web components, with no setup on the page.

It is a library first.
The browser extension in `extension/` is its demo: load it, and paint on any site.

## Install

```sh
npm install web-selection
```

There are no runtime dependencies.

## Use

```ts
import { createBrush } from "web-selection";
import { toContext } from "web-selection/context";

const brush = createBrush();
brush.enable();

brush.on("end", async () => {
  const context = await toContext(brush.items());
  // context.parts: text and pictures in order, for a model's message
  // context.tokens: about how many input tokens they take
});
```

Send the parts to a model.
For the Anthropic API:

```ts
const content = context.parts.map((p) =>
  p.type === "text"
    ? { type: "text", text: p.text }
    : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } },
);
content.push({ type: "text", text: question });
```

`npm run example` opens a page that shows what a model gets for what you paint, in each format.

## The brush

`createBrush(options)` returns the brush.

| Option | Default | What it does |
|---|---|---|
| `root` | the page body | Where to select |
| `targets` | found by the brush | A CSS selector, or a test `(el) => boolean`, that names the elements that count; each is then selected as a whole |
| `exclude` | none | A test for elements to leave out, with everything inside them |
| `size` | 16 | The brush radius in CSS pixels, from 4 to 60 |
| `color` | `#4b57f0` | The paint colour |
| `look` | `"default"` | `"default"` makes the letters of selected text jitter and pins pictures and code like photos; `"none"` leaves the page as it is, so you can show the selection your own way |
| `hud` | `true` | Shows the status line at the bottom of the screen while the brush is on |
| `shadowRoot` | open roots only | How to reach shadow roots; an extension can pass `chrome.dom.openOrClosedShadowRoot` |
| `zIndex` | 2147483646 | The overlay's stacking order |

| Member | What it is |
|---|---|
| `enable()`, `disable()`, `toggle()`, `enabled` | Turns the brush on and off; the paint and the selection stay when it is off |
| `selected` | The selected elements, in reading order |
| `items()` | The selected elements, each with what the paint covers: see below |
| `marks()` | The places the user marked, numbered in the order they were made, each with its note and its box on the screen |
| `note(mark, text)` | Gives a mark its note; the next stroke then starts a new mark |
| `unmarked(fn)` | Runs `fn` with the page as it is without the brush, no paint and no look: for taking a screenshot of the tab |
| `text()` | The text of the selected elements, one per paragraph |
| `undo()`, `redo()`, `clear()` | The paint's history |
| `size` | The brush radius |
| `on(event, fn)` | `change` (the selected elements), `start` and `end` (each stroke; `end` gives its mark, the point where it ended, and whether it was cancelled), `marks` (a mark was added, taken away or given a note), `enabled`; returns a function that stops listening |
| `destroy()` | Takes the brush and everything it added off the page |

Each item from `items()` has:

| Field | What it is |
|---|---|
| `element`, `kind` | The element, and whether it is `text`, `media` or a `control` |
| `textNodes` | The text nodes that belong to it |
| `ranges` | The painted words, as DOM ranges; a word counts when paint covers enough of the middle of its line |
| `area` | Where the paint lies on the element: its `box` as shares of the element's width and height, the share it `coverage`s, and the `strokes` in the element's own pixels |
| `marks` | The marks whose paint lies on the element, each with its own `ranges` and `area`, its number `n` and its `note` |

While the brush is on:

| Action | How |
|---|---|
| Paint | Drag |
| Erase | Hold Alt and drag |
| Remove a whole stroke | Right-click on it |
| Cancel the stroke you are painting | Right-click during the drag, or Escape |
| Brush size | `[` and `]` |
| Undo, redo | Ctrl+Z, Ctrl+Shift+Z |
| Clear all paint | Delete |
| Copy the selected text | Ctrl+C |
| Put the brush away | Escape |

Clicks paint instead of opening links.
The mouse wheel still scrolls the page, and the scroll box under the pointer.

## Context for a model

`toContext(input, options)` takes the brush's items, plain elements, or DOM ranges such as the page's own text selection, so it works with any way of selecting.
It returns `{ parts, text, tokens }`.

| Option | Default | What it does |
|---|---|---|
| `text` | `"marked"` | `"marked"`: whole elements with the painted words between `<mark>` and `</mark>`; `"whole"`: whole elements; `"painted"`: only the painted words |
| `images` | `"full"` | `"full"`: the picture, a copy with the paint on it, and the painted box as numbers; `"balanced"`: the copy with the paint, smaller, and the box; `"budget"`: a crop of the painted part and the box; `"none"`: the picture's name and the box. Or a mix: `{ original, marked, crop, box, size }` |
| `around` | 300 | Characters of the text just before and after the selection |
| `budget` | none | The most tokens the context may take; less text around, smaller pictures, then less unpainted text, until it fits |
| `format` | `"markdown"` | `"markdown"` or `"json"` |
| `pixels` | none | Your own way to get a picture's pixels, used when the page may not read them, such as a screenshot of the tab |
| `color` | `#4b57f0` | The colour of the paint drawn on pictures |

A picture from another site cannot be read where it is; it is loaded again with CORS, which most image services allow, and `pixels` covers the rest.
An extension can take a screenshot of the tab with `chrome.tabs.captureVisibleTab` inside `brush.unmarked()`, which the `activeTab` permission allows.

Paint is read the way a person means it.
A single touch on a paragraph points at the paragraph, not at the word under the dab.
A stroke down through a paragraph, which paints a word here and there on each line, points at the whole paragraph too.
A stroke along words points at those words.

The context also gives the page's title and address, and the headings above the selection.
A table cell comes with its table's header row, code keeps its lines and its language, and a list item keeps its number.
`estimateTokens(text)` and `imageTokens(width, height)` give the counts it uses.

The defaults come from a test series: real questions about painted parts of test pages, answered by small and large models in every format.
See [tests/eval/RESULTS.md](tests/eval/RESULTS.md).

## Marks and notes

Strokes made one after another form one mark.
When the user gives the mark a note, the next stroke starts a new mark.
Once there are two marks or a note, the brush shows each mark's number at the top left of its paint.

`toContext()` then numbers the marks everywhere: `<mark id="2">` around the painted words of mark 2, `[Mark 2]` before an element that mark 2 covers as a whole, and each mark's number on the copy of a picture.
The notes come last, by number, after the page: they are what the user asks for.

The library has no note box of its own, so each project can ask for notes its own way.
The example and the extension use [demo/note-bubble.ts](demo/note-bubble.ts): a box beside each stroke, where typing a letter starts the note and the brush's keys keep working.
In the example it can also take the note by speech, through the browser's own speech recognition; in Chrome the audio goes to Google, in Edge to Microsoft.

## The extension

```sh
npm install
npm run build
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose "Load unpacked" and pick the `extension` folder.

The extension's button opens a small panel: start or stop the brush on the page, and see the trigger key, Alt+Shift+S by default.
Change in the panel opens the browser's shortcut settings.
It asks for no permissions beyond the page you start it on.

## The look

| Selected | Look |
|---|---|
| Text, code and buttons | The letters jitter: each one is nudged and turned a little, ten times a second, like a hand-drawn animation; code keeps its font, so its columns stay lined up |
| A picture or a video | Pinned like a photo: a white edge, a soft shadow and a small tilt |
| A picture in a box that clips it, such as a rounded card | Framed: a white edge inside it, with no tilt, so nothing is cut off |

The page's own letters stay where they are and only lose their fill; the brush draws them again on a canvas over the page.
So nothing moves or wraps again, the words under the paint stay the words the user painted, and the page's elements are left as they are.
When the system asks for less motion, the letters keep one jittered pose and do not move.
The rest is plain CSS on attributes of the selected element, in one style sheet; clearing the paint takes them away.

## Development

| Command | What it does |
|---|---|
| `npm run build` | Builds the library into `dist/` and the extension's scripts into `extension/` |
| `npm run dev` | Rebuilds the extension on each change; reload it to try it |
| `npm run example` | Serves the repo and opens the example |
| `npm run fixtures` | Serves the repo; the test pages are at http://localhost:5199/tests/fixtures/article.html |
| `npm run typecheck` | TypeScript in strict mode |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests in Chrome and Edge, and the real extension in Edge (Playwright) |
| `npm run eval` | The test series: real questions about painted parts of test pages and of real sites, answered and graded by models; see [tests/eval/RESULTS.md](tests/eval/RESULTS.md) |
| `npm run bench` | The benchmark: the brush used on 20 real sites with real mouse input, timed; see [tests/bench/RESULTS.md](tests/bench/RESULTS.md) |
| `npm run shots` | Screenshots of the brush on a test page |
| `npm run real` | Screenshots and timings on real sites |

## Limits

- Text inside cross-origin frames cannot be reached.
- Paint does not move with the page when the layout changes, such as when the window is resized.
- Paint over a box that scrolls on its own stays where it was painted when that box scrolls.

## License

MIT. See [LICENSE](LICENSE).
