// The test series that picks the default formats. Each case paints part of a test page the way
// a person would, asks the question that person would ask, and says what a correct answer is.
// Every case runs in each format of its kind, so the results show which format a model needs.
//
// Paint is given as one of:
//   phrase: [selector, text]          a stroke along a phrase
//   touch:  [selector, x, y]          one dab, at a share of the element's width and height
//   across: [selector, y, selector, y] one stroke from the first element down into the second
//   area:   [selector, points, radius] strokes at shares of a picture's width and height
//   marks:  [{ ...one of the above, note }] several marks, each with the note written after it
//   areaByCaption: [caption words, points, radius] like area, for a picture found by its caption
//   touchText: [selector, words]   one dab on the words, in the first element that holds them
//   acrossText: [selector, words, selector, words] one stroke from the first words down to the second

/** Formats for cases about text. */
export const TEXT_FORMATS = {
  whole: { text: "whole", images: "none" },
  marked: { text: "marked", images: "none" },
  painted: { text: "painted", images: "none" },
};

/** Formats for cases about pictures. */
export const PICTURE_FORMATS = {
  "name+box": { images: "none" },
  original: { images: { original: true } },
  "original+box": { images: { original: true, box: true } },
  marked: { images: { marked: true } },
  balanced: { images: "balanced" },
  full: { images: "full" },
  budget: { images: "budget" },
};

/** Cases with notes run in the default format: they test that each note goes with its mark. */
export const NOTE_FORMATS = {
  default: {},
};

/**
 * Cases on real sites run in the default format: they test what people do on real pages, in
 * many kinds of page and language. The pages are pinned to one version where the site allows it.
 */
export const REAL_FORMATS = {
  default: {},
};

export const CASES = [
  {
    id: "few-words",
    kind: "text",
    page: "article.html",
    paint: { phrase: ["#why + p + p", "6.7 ms"] },
    pointed: 'The number "6.7 ms" in the sentence "A drop from 30 to 25 frames per second is also five frames, but it costs 6.7 ms."',
    question: "Why is it this much?",
    expected: "30 fps gives each frame 33.3 ms and 25 fps gives 40 ms, so the drop adds 40 - 33.3 = 6.7 ms of work per frame.",
    rubric: "Must explain 6.7 ms as the difference between 40 ms (25 fps) and 33.3 ms (30 fps). An answer about the 3.3 ms of the drop from 60 to 50 fps scores 0.",
  },
  {
    id: "light-touch",
    kind: "text",
    page: "article.html",
    paint: { touch: ["#budget + p + p", 0.5, 0.5] },
    pointed:
      'The whole paragraph "The CPU and the GPU work at the same time, on different frames. While the GPU draws frame 10, the CPU already prepares frame 11. So the frame takes as long as the slowest of them, not the sum." The user touched it once with the brush, near its middle.',
    question: "Can you explain this more simply?",
    expected: "The CPU and the GPU work in parallel on different frames, so a frame takes as long as the slower of the two, not both added together.",
    rubric: "Must explain the paragraph: the CPU and GPU work in parallel and the frame time is set by the slower one, not the sum. Explaining only a single word, or a different paragraph, scores 0.",
  },
  {
    id: "two-paragraphs",
    kind: "text",
    page: "article.html",
    paint: { across: ["#why + p", 0.3, "#why + p + p", 0.6] },
    pointed:
      'Two paragraphs: "Frame rate is the number of frames ... only frame time adds up: if the shadows take 2 ms and the post effects take 3 ms, together they take 5 ms." and "Frame rate does not add up like that. A drop from 60 to 50 frames per second costs 3.3 ms ... from 30 to 25 ... costs 6.7 ms."',
    question: "How do these two parts connect?",
    expected:
      "The first shows that frame times add up (2 ms + 3 ms = 5 ms); the second shows frame rates do not: the same drop of five frames per second costs 3.3 ms or 6.7 ms depending on where it starts. Together they argue for comparing costs in milliseconds.",
    rubric: "Must say the first part shows milliseconds add up and the second shows the same drop in frame rate can cost different amounts of time. Discussing only one of the two scores 0.5.",
  },
  {
    id: "table-cell",
    kind: "text",
    page: "article.html",
    paint: { phrase: ["tbody tr:nth-child(2) td:nth-child(3)", "16.7 ms"] },
    pointed: 'The cell "16.7 ms" in the row "Console, performance | 60 fps" of a table of frame rates and the time each frame gets.',
    question: "What does this number mean?",
    expected: "At 60 frames per second, the console performance target, each frame gets 16.7 ms: the time budget for one frame.",
    rubric: "Must connect 16.7 ms to 60 fps and the time one frame gets. Explaining a different cell (33.3, 8.3 or 4.2 ms) scores 0.",
  },
  {
    id: "code-line",
    kind: "text",
    page: "article.html",
    paint: { phrase: ["pre:has(.language-cpp)", "const double Ms = (FPlatformTime::Seconds() - Start) * 1000.0;"] },
    pointed: 'The third line of a C++ snippet: "const double Ms = (FPlatformTime::Seconds() - Start) * 1000.0;"',
    question: "What does this line do?",
    expected: "It takes the current time minus the start time, which is the elapsed time in seconds, and multiplies it by 1000 to store it in Ms as milliseconds.",
    rubric: "Must describe that line: elapsed seconds since Start, converted to milliseconds. Describing another line, such as the UE_LOG line, scores 0.",
  },
  {
    id: "list-step",
    kind: "text",
    page: "article.html",
    paint: { phrase: ["ol li:nth-child(3)", "Shadow depths"] },
    pointed: 'The list item "Shadow depths, which draw the scene again from each shadow-casting light." It is step 3 in a numbered list of GPU passes.',
    question: "Which step comes right before this one?",
    expected: "The base pass, which writes the material data of each pixel to the G-buffer.",
    rubric: "Must name the base pass. Naming the depth prepass, lighting or anything else scores 0.",
  },
  {
    id: "person",
    kind: "picture",
    page: "pictures.html",
    paint: { area: ["#people", [[0.49, 0.47], [0.52, 0.62], [0.48, 0.78]], 14] },
    pointed: "The third person from the left in a group picture: a person in a purple shirt holding a guitar.",
    question: "What is this person holding?",
    expected: "A guitar.",
    rubric: "Must say a guitar. Naming another person's item (umbrella, balloon, book, dog) scores 0.",
  },
  {
    id: "neighbour",
    kind: "picture",
    page: "pictures.html",
    paint: { area: ["#people", [[0.67, 0.47], [0.7, 0.62], [0.67, 0.78]], 14] },
    pointed: "The fourth person from the left in a group picture: a person in an orange shirt reading a book. To their left stands a person in a purple shirt with a guitar.",
    question: "What is the person standing just to the left of this one holding?",
    expected: "A guitar; it is the person in the purple shirt.",
    rubric: "Must say a guitar. Saying a book (the painted person's own item), a balloon, or anything else scores 0.",
  },
  {
    id: "chart-bar",
    kind: "picture",
    page: "pictures.html",
    paint: { area: ["#frame-times", [[0.524, 0.36], [0.524, 0.74]], 10] },
    pointed: "The Thursday bar (27.9 ms, drawn in red) of a bar chart of average frame time per day.",
    question: "How does this day compare with the day before?",
    expected: "Thursday averaged 27.9 ms against 15.1 ms on Wednesday: about 12.8 ms more, nearly twice as long.",
    rubric: "Must compare Thursday's 27.9 ms with Wednesday's 15.1 ms (or say it nearly doubled from about 15 ms). Comparing other days scores 0.",
  },
  {
    id: "toolbar-icon",
    kind: "picture",
    page: "pictures.html",
    paint: { area: ["#toolbar", [[0.344, 0.5]], 12] },
    pointed: "The clock icon in a mail app's toolbar, which has icons for reply, archive, delete, snooze (clock), mark as unread and label.",
    question: "What does this icon do in the app?",
    expected: "It snoozes the message: the message is hidden and comes back to the inbox at a later time.",
    rubric: "Must say snooze, remind later or a similar time-based action. Saying archive, delete, mark as unread or label scores 0.",
  },
  {
    id: "notes-picture",
    kind: "notes",
    page: "pictures.html",
    paint: {
      marks: [
        { area: ["#people", [[0.14, 0.5], [0.14, 0.75]], 12], note: "Remove this person." },
        { area: ["#people", [[0.84, 0.5], [0.84, 0.75]], 12], note: "Make this one bigger." },
      ],
    },
    pointed: "Two marks on the group picture: mark 1 on the far-left person (yellow shirt, red umbrella) with the note \"Remove this person.\", and mark 2 on the far-right person (teal shirt, dog) with the note \"Make this one bigger.\"",
    question: "Do what my notes ask: say which change goes with which person.",
    expected: "Remove the person on the far left, in the yellow shirt with the red umbrella; make the person on the far right, in the teal shirt with the dog, bigger.",
    rubric: "Must link removing to the far-left person (yellow shirt, umbrella) and making bigger to the far-right person (teal shirt, dog). Getting one of the two right scores 0.5; swapping them or naming other people scores 0.",
  },
  {
    id: "notes-text",
    kind: "notes",
    page: "article.html",
    paint: {
      marks: [
        { phrase: ["#why + p + p", "6.7 ms"], note: "Is this number right?" },
        { phrase: ["tbody tr:nth-child(3) td:nth-child(3)", "8.3 ms"], note: "Where does this come from?" },
      ],
    },
    pointed: 'Mark 1 on "6.7 ms" in "A drop from 30 to 25 frames per second ... costs 6.7 ms." with the note "Is this number right?", and mark 2 on the table cell "8.3 ms" (High refresh monitor, 120 fps) with the note "Where does this come from?"',
    question: "Answer my notes.",
    expected: "1: Yes. 25 fps gives 40 ms a frame and 30 fps gives 33.3 ms, so the drop costs 6.7 ms. 2: 8.3 ms is 1000 ms divided by 120, the time one frame gets at 120 frames per second.",
    rubric: "Must answer both notes, each about its own number: confirm 6.7 ms (40 - 33.3) and explain 8.3 ms as 1000 / 120. Answering only one scores 0.5; mixing up which note is about which number scores 0.",
  },
  {
    id: "notes-mixed",
    kind: "notes",
    page: "pictures.html",
    paint: {
      marks: [
        { touch: ["#numbers + p", 0.5, 0.5], note: "Shorten this." },
        { area: ["#frame-times", [[0.524, 0.36], [0.524, 0.74]], 10], note: "Which day is this?" },
      ],
    },
    pointed: 'Mark 1 on the sentence "We measured the average frame time of the test level every day on the same machine, with the same camera path." with the note "Shorten this.", and mark 2 on the Thursday bar (27.9 ms) of the chart with the note "Which day is this?"',
    question: "Do what my notes ask.",
    expected: "1: A shorter version of the sentence, such as \"We measured the test level's frame time daily.\" 2: Thursday, at 27.9 ms.",
    rubric: "Must give a shorter version of the measuring sentence for note 1 and say Thursday for note 2. One of the two right scores 0.5; applying a note to the wrong mark scores 0.",
  },
  // ---------- real sites ----------
  {
    id: "real-wikipedia-sentence",
    kind: "real",
    page: "https://en.wikipedia.org/w/index.php?title=Frame_rate&oldid=1380923337",
    paint: { phrase: ["#mw-content-text p", "every odd frame is repeated, playing twice, while every even frame is tripled"] },
    pointed: "On Wikipedia's \"Frame rate\" article, the words \"every odd frame is repeated, playing twice, while every even frame is tripled\", about converting 24 FPS film to 60 FPS video.",
    question: "Why does this make motion look uneven?",
    expected: "Frames are held on screen for different lengths of time (two refreshes, then three, in the 2:3 pulldown), so movement advances in an irregular rhythm, which shows as judder.",
    rubric: "Must say the frames are shown for unequal times (2 then 3 refreshes or fields), which makes the motion irregular or judder. A general answer about low frame rates scores 0.",
  },
  {
    id: "real-wikipedia-touch",
    kind: "real",
    page: "https://en.wikipedia.org/w/index.php?title=Frame_rate&oldid=1380923337",
    paint: { touchText: ["#mw-content-text p", "Saturday morning cartoons"] },
    pointed: "On Wikipedia's \"Frame rate\" article, a single touch on the paragraph \"Animation for most Saturday morning cartoons ... was most often shot on threes or even fours ... This translates to only 8 or 6 drawings per second.\"",
    question: "Explain this simply.",
    expected: "Cheap TV cartoons from the 1960s on reused each drawing for three or four film frames, so they showed only 8 or 6 new drawings per second, to save money.",
    rubric: "Must explain shooting on threes or fours: each drawing held for 3 or 4 frames, giving about 8 or 6 drawings per second, done to keep costs down. Explaining only one word scores 0.",
  },
  {
    id: "real-wikipedia-picture",
    kind: "real",
    page: "https://en.wikipedia.org/w/index.php?title=Cat&oldid=1381299280",
    paint: { areaByCaption: ["Skulls of a wildcat", [[0.7, 0.18], [0.82, 0.3], [0.72, 0.36]], 12] },
    pointed: "On Wikipedia's \"Cat\" article, the top-right skull of the picture captioned \"Skulls of a wildcat (top left), a housecat (top right), and a hybrid between the two (bottom center)\".",
    question: "Which animal's skull is this one?",
    expected: "A housecat, the domestic cat: the caption puts it at the top right.",
    rubric: "Must say a housecat or domestic cat. Saying wildcat or hybrid scores 0.",
  },
  {
    id: "real-wikipedia-table",
    kind: "real",
    page: "https://en.wikipedia.org/w/index.php?title=Comparison_of_video_codecs&oldid=1370679766",
    paint: { phrase: ["table", "2018-06-25"] },
    pointed: "On Wikipedia's \"Comparison of video codecs\", the cell \"2018-06-25\" in the row of AOM Video 1 (AV1), in the column \"First public release date\".",
    question: "What is this date?",
    expected: "The first public release date of the AV1 codec (AOM Video 1, from the Alliance for Open Media): 25 June 2018.",
    rubric: "Must say it is AV1's first public release date. Naming another codec or another kind of date scores 0.",
  },
  {
    id: "real-japanese",
    kind: "real",
    page: "https://ja.wikipedia.org/w/index.php?oldid=110449247",
    paint: { phrase: ["#mw-content-text p", "日本では1枚の画を3枚の連続したコマに割り当てる「3コマ打ち」が滑らかに見える限界とされている"] },
    pointed: "On Japanese Wikipedia's \"Frame rate\" article, the sentence 日本では1枚の画を3枚の連続したコマに割り当てる「3コマ打ち」が滑らかに見える限界とされている.",
    question: "Translate this into English.",
    expected: "In Japan, shooting on threes, where one drawing is assigned to three consecutive frames, is considered the limit for motion to still look smooth.",
    rubric: "Must say one drawing is held for three consecutive frames (shooting on threes) and that this is considered the limit of looking smooth. Missing either part scores 0.5.",
  },
  {
    id: "real-arabic",
    kind: "real",
    page: "https://ar.wikipedia.org/w/index.php?oldid=76650814",
    paint: { phrase: ["#mw-content-text p", "بدأ استئناس القطط في الشرق الأدنى منذ نحو 7500 سنة قبل الميلاد"] },
    pointed: "On Arabic Wikipedia's \"Cat\" article, read right to left, the words بدأ استئناس القطط في الشرق الأدنى منذ نحو 7500 سنة قبل الميلاد.",
    question: "What does this say? Answer in English.",
    expected: "Cat domestication began in the Near East around 7500 BCE.",
    rubric: "Must say cats were first domesticated in the Near East about 7500 BCE. A wrong place or date scores 0.",
  },
  {
    id: "real-mdn",
    kind: "real",
    page: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
    paint: { phrase: ["p", "Array.prototype.map passes 3 arguments: the element, the index, and the array."] },
    pointed: "On MDN's Array.prototype.map() page, the sentence \"Array.prototype.map passes 3 arguments: the element, the index, and the array.\" in the part about parseInt.",
    question: "Why does this cause a problem with parseInt?",
    expected: "parseInt takes a second argument, the radix, so map's index is passed as the radix: ['1', '2', '3'].map(parseInt) gives [1, NaN, NaN].",
    rubric: "Must explain that the index becomes parseInt's radix and give the wrong result such as [1, NaN, NaN]. Explaining only map in general scores 0.",
  },
  {
    id: "real-python-docs",
    kind: "real",
    page: "https://docs.python.org/3.12/library/functions.html",
    paint: { phrase: ["pre", "if element:"] },
    pointed: "In the Python docs for any(), the line \"if element:\" in the code that shows what any() does.",
    question: "What happens when this is true?",
    expected: "any() returns True right away, without looking at the rest of the iterable.",
    rubric: "Must say any() returns True at once (it stops at the first true element). Describing all() scores 0.",
  },
  {
    id: "real-github-readme",
    kind: "real",
    page: "https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/README.md",
    paint: { phrase: ["pre", "npm install @mozilla/readability"] },
    pointed: "In the README of Mozilla's Readability on GitHub, the command npm install @mozilla/readability.",
    question: "What does this do, and what do I need first?",
    expected: "It installs Mozilla's Readability library (which pulls the main content out of web pages) from npm into the project; you need Node.js with npm first.",
    rubric: "Must say it installs the Readability package from npm and that Node.js or npm is needed first. Missing one part scores 0.5.",
  },
  {
    id: "real-github-code",
    kind: "real",
    page: "https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/Readability.js",
    paint: { phrase: [".react-file-line", "if (numTags > this._maxElemsToParse) {"] },
    pointed: "In Readability.js on GitHub, the line if (numTags > this._maxElemsToParse) { at the start of parse().",
    question: "Why is this check here?",
    expected: "To stop parsing documents that are too large: if the page has more elements than the maxElemsToParse option allows, parse() throws an error instead of doing slow work.",
    rubric: "Must say it aborts parsing (throws) when the document has more elements than the configured maximum, to avoid parsing too-large documents.",
  },
  {
    id: "real-hacker-news",
    kind: "real",
    page: "https://news.ycombinator.com/item?id=8863",
    paint: { phrase: [".commtext", "you can already build such a system yourself quite trivially by getting an FTP account"] },
    pointed: "On the Hacker News thread \"My YC app: Dropbox\", the words \"you can already build such a system yourself quite trivially by getting an FTP account\" in the first comment.",
    question: "What is this person's objection, in one sentence?",
    expected: "That Dropbox is not needed, because a Linux user can build the same thing with an FTP account mounted with curlftpfs plus SVN or CVS.",
    rubric: "Must say the objection is that you can build it yourself with FTP, curlftpfs and version control. Discussing other points of the comment instead scores 0.5.",
  },
  {
    id: "real-unity-screenshot",
    kind: "real",
    page: "https://docs.unity3d.com/6000.0/Documentation/Manual/ProfilerWindow.html",
    paint: { area: ["img[alt^='Profiler window with a frame']", [[0.5, 0.25], [0.7, 0.33], [0.9, 0.25]], 14] },
    pointed: "On Unity's Profiler window manual page, the chart at the top right of the Profiler screenshot: the CPU Usage chart over recent frames, with lines at 66 ms (15 FPS), 33 ms (30 FPS) and 16 ms (60 FPS).",
    question: "What does this chart show?",
    expected: "The CPU Usage module's chart: how long the CPU took for each recent frame, split by category, against lines for 66 ms (15 FPS), 33 ms (30 FPS) and 16 ms (60 FPS).",
    rubric: "Must identify the CPU usage chart showing time per frame (frame times over recent frames). Describing the timeline at the bottom or the captures list scores 0.",
  },
  {
    id: "real-notes",
    kind: "real",
    page: "https://en.wikipedia.org/w/index.php?title=Frame_rate&oldid=1380923337",
    paint: {
      marks: [
        { areaByCaption: ["galloping horse", [[0.4, 0.4], [0.6, 0.6]], 12], note: "Is this smooth or jerky, and why?" },
        { phrase: ["#mw-content-text p", "60 frames per second has for a long time been considered the minimum frame rate for smoothly animated game play"], note: "Is this still true today?" },
      ],
    },
    pointed: "On Wikipedia's \"Frame rate\" article: mark 1 on the animated galloping horse picture (12 drawings per second) with the note \"Is this smooth or jerky, and why?\", and mark 2 on the sentence about 60 frames per second being the minimum for smooth game play with the note \"Is this still true today?\"",
    question: "Answer my notes.",
    expected: "1: Somewhat jerky: it shows 12 drawings per second, which the caption calls on the edge of objectionably jerky for fast motion. 2: 60 FPS is still a common target for smooth play, though many console games run at 30 FPS and high-refresh displays go to 120 FPS or more.",
    rubric: "Must answer note 1 about the horse (12 drawings per second, borderline jerky) and note 2 about 60 FPS in games with a reasonable view of today. Mixing up the notes scores 0; answering only one scores 0.5.",
  },
  {
    id: "real-summary",
    kind: "real",
    page: "https://en.wikipedia.org/w/index.php?title=Comparison_of_video_codecs&oldid=1370679766",
    paint: { acrossText: ["#mw-content-text p", "Prior to comparing codec video-quality", "#mw-content-text p", "For a sufficiently long clip"] },
    pointed: "On Wikipedia's \"Comparison of video codecs\", two paragraphs: \"Prior to comparing codec video-quality ... bitrate control mechanism ...\" and \"For a sufficiently long clip ... any two codecs may perform quite differently ...\".",
    question: "Summarize this in two sentences.",
    expected: "A codec's quality varies from frame to frame because its bitrate control spends bits unevenly, especially with constant bitrate. So short clips can be picked to make a codec look better or worse, and over a long clip two codecs may each win in different parts.",
    rubric: "Must say quality varies across frames due to bitrate control (VBR or CBR) and that selected clips can mislead comparisons. Missing one part scores 0.5.",
  },
];
