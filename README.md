# web-selection

Photoshop-style selection for any web page.
Point at a part of the page and smart select takes what belongs with it.
Or click a paragraph with the magic wand, drag a marquee, draw a lasso, or paint with a brush.
Shift adds, Alt subtracts, and Shift+Alt intersects, as in Photoshop.
The result is a clean selection of blocks, text and pictures that other tools can use.

It has no runtime dependencies and never moves or changes the page's own nodes.

## How Photoshop maps to a page

| Photoshop | On a web page |
|---|---|
| Pixel | One character of text, or one picture, video or frame |
| Object Selection, Object Finder | Smart select: point at any part to see what belongs with it, then click (see below) |
| Magic wand | Click a block to select the blocks that look like it: kind, font, size, weight, colour, background and indent |
| Tolerance | How alike blocks must look, from 0 (the same look) to 100 (everything) |
| Contiguous on | Only the run of alike blocks around the click, for example one section's paragraphs |
| Contiguous off | Every alike block on the page, for example every code block |
| Marquee, Lasso | Drag a box or draw a shape to select the exact characters inside it |
| Quick Selection brush | Paint over blocks to select each block you touch |
| Quick Mask painting | The brush with "Whole blocks" off paints only the characters under it |
| Shift, Alt, Shift+Alt | Add, subtract, intersect |
| Grow, Similar, Inverse | Grow, Similar and Invert, on blocks |
| Expand, Contract | Add or remove one block at each end of each run |
| Select Subject | Main text: the page's main article, without menus and side bars |
| Marching ants, Quick Mask | Ants around the selection, or a red tint over everything outside it |

Smart select and the wand show what a click will take while you hover, so the target is always clear.

## Smart select

Smart select finds the part of the page that belongs together:

| You point at | It takes |
|---|---|
| A paragraph | The paragraph |
| A list item | The whole list, with the sentence that leads into it when that sentence ends with a colon |
| A picture | The figure with its caption |
| A table cell | The whole table with its caption |
| A code block | The code, with the sentence that leads into it |
| A term or a definition | The term with its definitions |
| A card or a note box | The whole box |
| A heading | Its section: the heading and everything under it, up to the next heading of the same level |

Click inside the selection to take the section around it, under its title.
Each further click takes the section around that one.
"Takes: Section" in the tool bar takes the section on the first click.
A heading inside a card or a note heads only that box, and boxes that float over the page, such as cookie banners, stay out.

## Try it

On the playground page:

```sh
npm install
npm run dev
```

Then open http://localhost:5199/.
The tools start on.
Press Escape to put them away and S to bring them back.

On any site, with the try-it extension:

```sh
npm run build
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose "Load unpacked" and pick the `extension` folder.
4. On any page, click the extension's button or press Alt+Shift+S.

## Keys

The keys work while the tools are on.

| Key | Action |
|---|---|
| S, W, M, L, B, T | Smart select, magic wand, marquee, lasso, brush, text |
| Shift, Alt, Shift+Alt | Add, subtract or intersect for the next click or drag |
| [ and ] | Tolerance down and up, or brush size with the brush |
| Q | Switch between ants and mask view |
| Ctrl+A | Select all |
| Ctrl+D, Ctrl+Shift+D | Deselect, reselect |
| Ctrl+I | Invert |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C | Copy the selected text |
| Enter | Tell the host page you are done (the `commit` event) |
| Escape | Stop a drag, or put the tools away; the selection stays |

Ctrl+Shift+I would be Photoshop's key for Inverse, but browsers keep it for their developer tools.

## Use it in code

```ts
import { createWebSelection } from "web-selection";

const ws = createWebSelection({
  exclude: (el) => el.matches("#my-panel"),
});
ws.enable();

ws.on("change", (selection) => {
  console.log(selection.stats, selection.text());
});
ws.on("commit", (selection) => {
  for (const part of selection.parts) console.log(part.kind, part.whole, part.text);
});

ws.set({ tool: "marquee", tolerance: 30 });
ws.run("mainText");
ws.select(document.querySelector("article")!);
```

`selection.parts` gives each touched block with its element, its kind (heading, paragraph, list item, code, quote, cell, caption, term, media or text), whether all of it is selected, its text, and a DOM range.
`selection.ranges()` gives live DOM ranges, one for each run.
`selection.media` gives the selected pictures and videos.
`selection.context()` gives the titles above the selection, outermost first, and the running text just before and after it in the same section.
A tool that explains the selection can send this along, so the answer knows the topic without the whole page.

Options:

| Option | Meaning |
|---|---|
| `root` | Where to select. The default is the page body. |
| `exclude` | Elements to leave out, with everything inside them. |
| `palette` | Show the built-in tool bar. The default is true. |
| `exitOnEscape` | Escape puts the tools away. The default is true. |
| `shadowRoot` | How to reach shadow roots. An extension can pass `chrome.dom.openOrClosedShadowRoot` to reach closed ones. |
| `tool`, `mode`, `reach`, `tolerance`, `contiguous`, `wholeBlocks`, `brushSize`, `brushBlocks`, `view` | Starting settings. The tool bar starts with smart select. |

## How it works

The page index walks the flat tree, so text in shadow roots and slots counts, and gives every visible character and picture a position in reading order.
A selection is a set of runs over those positions: a one-dimensional mask, where Photoshop has a two-dimensional one.
Add, subtract, intersect and invert are set operations on the runs.

A block is the innermost box that lays out its own lines of text, or a picture large enough to stand alone.
Each block has a look: its kind, type size, weight, font, colour, background, indent, list and table column.
The wand compares looks the way Photoshop compares colours.
As a guide, a tolerance of about 20 keeps to one kind of block, and about 40 takes most body text.

The overlay is one element at the page's origin with a shadow root.
It draws in page coordinates, so the outline scrolls with the page without being redrawn.
Whole blocks are drawn as their boxes and partial text as solid line bands.
A card, note, table, list or figure that is all selected is drawn as its own box.
Blocks that follow each other are joined into one area with one outline.
While the tools are on, a clear layer takes the pointer, so clicks select instead of opening links.

The selection is kept as live DOM ranges, so it follows the page when the page changes.

## Limits

- Text inside cross-origin frames cannot be reached.
- Text drawn on a canvas, as in Google Docs or a PDF viewer, has no characters to select.
- Closed shadow roots need an accessor such as `chrome.dom.openOrClosedShadowRoot`.
- Touch input works but is not tuned yet.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Playground at http://localhost:5199/ |
| `npm run build` | The library in `dist`, and the script build in `extension` |
| `npm run typecheck` | TypeScript in strict mode |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests in Chrome and Edge (Playwright) |
| `npm run shots` | Screenshots of each tool on the playground |
| `npm run shots:smart` | Screenshots of smart select on the playground |
| `npm run real` | Screenshots and timings on real sites |

## License

MIT. See [LICENSE](LICENSE).
