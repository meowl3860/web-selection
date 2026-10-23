// Rough token counts, so a tool can keep within a budget and warn before it sends. They follow
// what Claude Haiku 5.5 and Opus 5.5 counted for this library's own output in October 2026:
// about 2.8 characters a token for text in Latin letters, about one token for each Chinese,
// Japanese or Korean character, and width × height / 750 for a picture. Other models count
// differently, but not by much.

// Script extensions also take in marks the scripts share, such as the long vowel mark ー.
const WIDE = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/u;
const CHARS_PER_TOKEN = 2.8;

/** About how many tokens a text takes. */
export function estimateTokens(text: string): number {
  let wide = 0;
  let all = 0;
  for (const ch of text) {
    all++;
    if (WIDE.test(ch)) wide++;
  }
  return Math.ceil((all - wide) / CHARS_PER_TOKEN + wide);
}

/** About how many tokens a picture of this size takes. */
export function imageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}
