# Test series results

<!-- Written by tests/eval/run.mjs. Run it again rather than editing this file. -->

Run on 2026-10-21 with claude-haiku-5-5 and claude-opus-5-5 answering and claude-opus-5-5 grading, through the claude CLI.
27 cases, 3 runs each, 378 answers.
A score is the mean grade: 1 for a correct answer about what the user pointed at, 0.5 for a partly right one, 0 for a wrong one.
Tokens are the input tokens the context took, measured by the model, without the question and the fixed preamble.

## Text

| Format | haiku score | opus score | haiku tokens | opus tokens | Estimated tokens | haiku seconds | opus seconds |
|---|---|---|---|---|---|---|---|
| whole | 0.83 | 0.92 | 398 | 395 | 389 | 3.7 | 4.2 |
| marked | 0.97 | 1.00 | 426 | 422 | 414 | 3.2 | 4.2 |
| painted | 0.44 | 0.58 | 334 | 331 | 334 | 3.5 | 5.1 |

## Pictures

| Format | haiku score | opus score | haiku tokens | opus tokens | Estimated tokens | haiku seconds | opus seconds |
|---|---|---|---|---|---|---|---|
| name+box | 0.00 | 0.00 | 294 | 291 | 308 | 3.3 | 4.2 |
| original | 0.42 | 0.54 | 635 | 633 | 642 | 3.0 | 4.5 |
| original+box | 0.92 | 1.00 | 659 | 657 | 661 | 3.3 | 4.1 |
| marked | 1.00 | 1.00 | 661 | 658 | 668 | 2.4 | 3.7 |
| balanced | 1.00 | 1.00 | 663 | 659 | 668 | 2.6 | 3.3 |
| full | 1.00 | 1.00 | 1052 | 1047 | 1040 | 2.5 | 3.5 |
| budget | 0.38 | 0.46 | 385 | 381 | 388 | 2.9 | 3.9 |

## Notes on marks

| Format | haiku score | opus score | haiku tokens | opus tokens | Estimated tokens | haiku seconds | opus seconds |
|---|---|---|---|---|---|---|---|
| default | 1.00 | 1.00 | 1060 | 1057 | 1038 | 3.1 | 3.6 |

## Real sites

| Format | haiku score | opus score | haiku tokens | opus tokens | Estimated tokens | haiku seconds | opus seconds |
|---|---|---|---|---|---|---|---|
| default | 0.96 | 0.98 | 648 | 644 | 630 | 3.2 | 4.3 |

## Each case

### few-words

Why is it this much? (The number "6.7 ms" in the sentence "A drop from 30 to 25 frames per second is also five frames, but it costs 6.7 ms.")

| Format | haiku | opus |
|---|---|---|
| whole | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| painted | 0, 0, 0 | 0, 0, 0 |

### light-touch

Can you explain this more simply? (The whole paragraph "The CPU and the GPU work at the same time, on different frames. While the GPU draws frame 10, the CPU already prepares frame 11. So the frame takes as long as the slowest of them, not the sum." The user touched it once with the brush, near its middle.)

| Format | haiku | opus |
|---|---|---|
| whole | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 0.5, 1 | 1, 1, 1 |
| painted | 0, 0, 0 | 0, 0, 0 |

### two-paragraphs

How do these two parts connect? (Two paragraphs: "Frame rate is the number of frames ... only frame time adds up: if the shadows take 2 ms and the post effects take 3 ms, together they take 5 ms." and "Frame rate does not add up like that. A drop from 60 to 50 frames per second costs 3.3 ms ... from 30 to 25 ... costs 6.7 ms.")

| Format | haiku | opus |
|---|---|---|
| whole | 0.5, 0.5, 0.5 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| painted | 0, 0, 0 | 0.5, 0.5, 0.5 |

### table-cell

What does this number mean? (The cell "16.7 ms" in the row "Console, performance | 60 fps" of a table of frame rates and the time each frame gets.)

| Format | haiku | opus |
|---|---|---|
| whole | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| painted | 1, 1, 1 | 1, 1, 1 |

### code-line

What does this line do? (The third line of a C++ snippet: "const double Ms = (FPlatformTime::Seconds() - Start) * 1000.0;")

| Format | haiku | opus |
|---|---|---|
| whole | 0.5, 0.5, 0.5 | 0.5, 0.5, 0.5 |
| marked | 1, 1, 1 | 1, 1, 1 |
| painted | 0.5, 1, 0.5 | 1, 1, 1 |

### list-step

Which step comes right before this one? (The list item "Shadow depths, which draw the scene again from each shadow-casting light." It is step 3 in a numbered list of GPU passes.)

| Format | haiku | opus |
|---|---|---|
| whole | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| painted | 1, 1, 1 | 1, 1, 1 |

### person

What is this person holding? (The third person from the left in a group picture: a person in a purple shirt holding a guitar.)

| Format | haiku | opus |
|---|---|---|
| name+box | 0, 0, 0 | 0, 0, 0 |
| original | 0.5, 0.5, 0.5 | 0.5, 0.5, 0.5 |
| original+box | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| balanced | 1, 1, 1 | 1, 1, 1 |
| full | 1, 1, 1 | 1, 1, 1 |
| budget | 1, 1, 1 | 1, 1, 1 |

### neighbour

What is the person standing just to the left of this one holding? (The fourth person from the left in a group picture: a person in an orange shirt reading a book. To their left stands a person in a purple shirt with a guitar.)

| Format | haiku | opus |
|---|---|---|
| name+box | 0, 0, 0 | 0, 0, 0 |
| original | 0, 0, 0 | 0.5, 0.5, 0.5 |
| original+box | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| balanced | 1, 1, 1 | 1, 1, 1 |
| full | 1, 1, 1 | 1, 1, 1 |
| budget | 0, 0, 0 | 0, 0, 0 |

### chart-bar

How does this day compare with the day before? (The Thursday bar (27.9 ms, drawn in red) of a bar chart of average frame time per day.)

| Format | haiku | opus |
|---|---|---|
| name+box | 0, 0, 0 | 0, 0, 0 |
| original | 1, 1, 1 | 1, 1, 1 |
| original+box | 1, 1, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| balanced | 1, 1, 1 | 1, 1, 1 |
| full | 1, 1, 1 | 1, 1, 1 |
| budget | 0, 0, 0 | 0, 0, 0 |

### toolbar-icon

What does this icon do in the app? (The clock icon in a mail app's toolbar, which has icons for reply, archive, delete, snooze (clock), mark as unread and label.)

| Format | haiku | opus |
|---|---|---|
| name+box | 0, 0, 0 | 0, 0, 0 |
| original | 0, 0, 0.5 | 0, 0, 0.5 |
| original+box | 1, 0, 1 | 1, 1, 1 |
| marked | 1, 1, 1 | 1, 1, 1 |
| balanced | 1, 1, 1 | 1, 1, 1 |
| full | 1, 1, 1 | 1, 1, 1 |
| budget | 0.5, 0.5, 0.5 | 1, 1, 0.5 |

### notes-picture

Do what my notes ask: say which change goes with which person. (Two marks on the group picture: mark 1 on the far-left person (yellow shirt, red umbrella) with the note "Remove this person.", and mark 2 on the far-right person (teal shirt, dog) with the note "Make this one bigger.")

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### notes-text

Answer my notes. (Mark 1 on "6.7 ms" in "A drop from 30 to 25 frames per second ... costs 6.7 ms." with the note "Is this number right?", and mark 2 on the table cell "8.3 ms" (High refresh monitor, 120 fps) with the note "Where does this come from?")

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### notes-mixed

Do what my notes ask. (Mark 1 on the sentence "We measured the average frame time of the test level every day on the same machine, with the same camera path." with the note "Shorten this.", and mark 2 on the Thursday bar (27.9 ms) of the chart with the note "Which day is this?")

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-wikipedia-sentence

Why does this make motion look uneven? (On Wikipedia's "Frame rate" article, the words "every odd frame is repeated, playing twice, while every even frame is tripled", about converting 24 FPS film to 60 FPS video.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-wikipedia-touch

Explain this simply. (On Wikipedia's "Frame rate" article, a single touch on the paragraph "Animation for most Saturday morning cartoons ... was most often shot on threes or even fours ... This translates to only 8 or 6 drawings per second.")

| Format | haiku | opus |
|---|---|---|
| default | 0.5, 1, 0.5 | 1, 1, 0.5 |

### real-wikipedia-picture

Which animal's skull is this one? (On Wikipedia's "Cat" article, the top-right skull of the picture captioned "Skulls of a wildcat (top left), a housecat (top right), and a hybrid between the two (bottom center)".)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-wikipedia-table

What is this date? (On Wikipedia's "Comparison of video codecs", the cell "2018-06-25" in the row of AOM Video 1 (AV1), in the column "First public release date".)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-japanese

Translate this into English. (On Japanese Wikipedia's "Frame rate" article, the sentence 日本では1枚の画を3枚の連続したコマに割り当てる「3コマ打ち」が滑らかに見える限界とされている.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-arabic

What does this say? Answer in English. (On Arabic Wikipedia's "Cat" article, read right to left, the words بدأ استئناس القطط في الشرق الأدنى منذ نحو 7500 سنة قبل الميلاد.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 0.5, 1 |

### real-mdn

Why does this cause a problem with parseInt? (On MDN's Array.prototype.map() page, the sentence "Array.prototype.map passes 3 arguments: the element, the index, and the array." in the part about parseInt.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 0.5, 1 | 1, 1, 1 |

### real-python-docs

What happens when this is true? (In the Python docs for any(), the line "if element:" in the code that shows what any() does.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-github-readme

What does this do, and what do I need first? (In the README of Mozilla's Readability on GitHub, the command npm install @mozilla/readability.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-github-code

Why is this check here? (In Readability.js on GitHub, the line if (numTags > this._maxElemsToParse) { at the start of parse().)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-hacker-news

What is this person's objection, in one sentence? (On the Hacker News thread "My YC app: Dropbox", the words "you can already build such a system yourself quite trivially by getting an FTP account" in the first comment.)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-unity-screenshot

What does this chart show? (On Unity's Profiler window manual page, the chart at the top right of the Profiler screenshot: the CPU Usage chart over recent frames, with lines at 66 ms (15 FPS), 33 ms (30 FPS) and 16 ms (60 FPS).)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-notes

Answer my notes. (On Wikipedia's "Frame rate" article: mark 1 on the animated galloping horse picture (12 drawings per second) with the note "Is this smooth or jerky, and why?", and mark 2 on the sentence about 60 frames per second being the minimum for smooth game play with the note "Is this still true today?")

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

### real-summary

Summarize this in two sentences. (On Wikipedia's "Comparison of video codecs", two paragraphs: "Prior to comparing codec video-quality ... bitrate control mechanism ..." and "For a sufficiently long clip ... any two codecs may perform quite differently ...".)

| Format | haiku | opus |
|---|---|---|
| default | 1, 1, 1 | 1, 1, 1 |

Fixed preamble measured per model: haiku 709, opus 745 tokens.
