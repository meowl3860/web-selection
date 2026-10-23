# Benchmark results

<!-- Written by tests/bench/run.mjs. Run it again rather than editing this file. -->

Run on 2026-10-21 in Chrome, 1280 × 900, on 20 real sites; 20 ran, 0 could not load.
Each site gets the same session with real mouse input: a touch, a phrase, a sweep that scrolls the page, a scribble on a picture, a right-click, erasing, undo and redo, two notes, and wheel scrolling.
Times are the brush's own work in milliseconds. Smooth means the RAIL limits: continuous work (a move, a scroll, a frame, the jitter) within one frame at 60 Hz, 16.7 ms, and the answer to a single click or key within 50 ms.

| Site | Kind | Elements | Selected | Move p95 | Worst continuous | Worst click or key | Slowest part | Jitter draw p95 | Items | Context | Tokens | Moved px | Our errors | Smooth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wikipedia-long | article | 165 | 12 | 0.4 | 5.1 | 5.4 | pointerUp | 2.5 | 21 | 9.4 | 2092 | 0 | 0 | yes |
| wikipedia-pictures | article, pictures | 725 | 15 | 0.4 | 4.4 | 6.4 | keyDown | 2.8 | 62 | 11 | 2373 | 0 | 0 | yes |
| wikipedia-tables | big tables | 944 | 30 | 0.6 | 6.7 | 5.8 | jitterDraw | 3.5 | 33 | 9.0 | 2923 | 0 | 0 | yes |
| wikipedia-japanese | Japanese | 155 | 23 | 0.5 | 3.4 | 5.6 | pointerUp | 1.7 | 30 | 6.8 | 2354 | 0 | 0 | yes |
| wikipedia-arabic | right to left | 595 | 39 | 0.4 | 3.9 | 9.9 | keyDown | 0.8 | 66 | 228 | 3146 | 0 | 0 | yes |
| mdn | docs, code | 306 | 28 | 0.6 | 3.2 | 5.1 | pointerUp | 1.7 | 19 | 6.1 | 1109 | 0 | 0 | yes |
| python-docs | docs, very long | 645 | 30 | 0.2 | 2.9 | 3.2 | keyDown | 2.1 | 25 | 8.7 | 1739 | 0 | 0 | yes |
| unity-docs | docs, screenshots | 175 | 19 | 0.3 | 2.6 | 5.4 | pointerUp | 1.6 | 14 | 56 | 2829 | 0 | 0 | yes |
| unreal-docs | docs, tables | 493 | 22 | 0.4 | 5.7 | 12 | keyDown | 0.6 | 19 | 31 | 1344 | 0 | 0 | yes |
| github-readme | code host | 169 | 20 | 0.6 | 2.9 | 5.0 | pointerUp | 2.3 | 16 | 5.8 | 1395 | 0 | 0 | yes |
| github-code | code view | 5495 | 71 | 0.2 | 7.4 | 4.5 | render | 1.0 | 69 | 13 | 2061 | 0 | 0 | yes |
| unity-forum | forum | 588 | 31 | 0.8 | 9.9 | 7.5 | scrolled | 1.7 | 27 | 10 | 1323 | 0 | 0 | yes |
| hacker-news | discussion | 220 | 20 | 0.5 | 3.6 | 5.4 | pointerUp | 3.5 | 21 | 6.8 | 1039 | 0 | 0 | yes |
| bbc | news | 254 | 18 | 0.5 | 4.0 | 8.8 | keyDown | 0.6 | 15 | 38 | 1407 | 0.7 | 0 | yes |
| guardian | news | 678 | 5 | 0.4 | 14 | 5.2 | render | 0.5 | 8.3 | 51 | 1355 | 0 | 0 | yes |
| amazon | shopping | 4 | 1 | 0.2 | 1.5 | 5.6 | pointerUp | 0.3 | 2.7 | 2.8 | 222 | 0 | 0 | yes |
| unsplash | picture gallery | 85 | 5 | 0.3 | 1.7 | 2.9 | pointerUp | 0.3 | 6.0 | 58 | 1774 | 0 | 0 | yes |
| artstation | dark, pictures | 296 | 18 | 1.9 | 11 | 15 | keyDown | 0.6 | 22 | 748 | 2866 | 0 | 0 | yes |
| reddit | web components | 10 | 1 | 0.2 | 2.6 | 3.0 | pointerUp | 0.4 | 3.1 | 2.8 | 269 | 0 | 0 | yes |
| youtube | heavy web app | 531 | 84 | 0.4 | 2.4 | 5.7 | pointerUp | 1.0 | 43 | 15 | 1360 | 0 | 0 | yes |
