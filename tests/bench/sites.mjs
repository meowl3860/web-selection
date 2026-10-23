// Real sites for the benchmark, chosen for variety: long articles, big tables, right-to-left
// and Japanese text, docs, code, discussions, news, shopping, picture galleries, dark pages and
// heavy web apps. Pages with versions are pinned to one, so runs compare.

export const SITES = [
  { name: "wikipedia-long", kind: "article", url: "https://en.wikipedia.org/w/index.php?title=Frame_rate&oldid=1380923337" },
  { name: "wikipedia-pictures", kind: "article, pictures", url: "https://en.wikipedia.org/w/index.php?title=Cat&oldid=1381299280" },
  { name: "wikipedia-tables", kind: "big tables", url: "https://en.wikipedia.org/w/index.php?title=Comparison_of_video_codecs&oldid=1370679766" },
  { name: "wikipedia-japanese", kind: "Japanese", url: "https://ja.wikipedia.org/w/index.php?oldid=110449247" },
  { name: "wikipedia-arabic", kind: "right to left", url: "https://ar.wikipedia.org/w/index.php?oldid=76650814" },
  { name: "mdn", kind: "docs, code", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map" },
  { name: "python-docs", kind: "docs, very long", url: "https://docs.python.org/3.12/library/functions.html" },
  { name: "unity-docs", kind: "docs, screenshots", url: "https://docs.unity3d.com/6000.0/Documentation/Manual/ProfilerWindow.html" },
  { name: "unreal-docs", kind: "docs, tables", url: "https://dev.epicgames.com/documentation/en-us/unreal-engine/stat-commands-in-unreal-engine" },
  { name: "github-readme", kind: "code host", url: "https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/README.md" },
  { name: "github-code", kind: "code view", url: "https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/Readability.js" },
  { name: "unity-forum", kind: "forum", url: "https://discussions.unity.com/latest" },
  { name: "hacker-news", kind: "discussion", url: "https://news.ycombinator.com/item?id=8863" },
  { name: "bbc", kind: "news", url: "https://www.bbc.com/news" },
  { name: "guardian", kind: "news", url: "https://www.theguardian.com/international" },
  { name: "amazon", kind: "shopping", url: "https://www.amazon.com/dp/B0D1XD1ZV3" },
  { name: "unsplash", kind: "picture gallery", url: "https://unsplash.com/s/photos/cat" },
  { name: "artstation", kind: "dark, pictures", url: "https://www.artstation.com/?sort_by=community" },
  { name: "reddit", kind: "web components", url: "https://www.reddit.com/r/pics/" },
  { name: "youtube", kind: "heavy web app", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
];
