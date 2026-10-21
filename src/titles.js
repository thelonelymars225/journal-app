// Titles for entries you didn't name. Built from the opening words of the
// entry with a few simple rules, on this device and instantly, so it works
// offline and in any language. A title you type yourself always wins.

const MAX_WORDS = 7;

// Openers that carry no meaning in a title ("So today I ...", "Honestly, ...").
const FILLER = /^(?:so|ok(?:ay)?|um+|uh+|hm+|well|honestly|anyway|anyways|basically|actually|just|like|and|but|also|then|today|tonight|this morning|this evening|right now|lately|i think|i feel like|i guess|i just|i'?m|i am|i)(?=[\s,.!?:;—–-]|$)[\s,.!?:;—–-]*/i;

// Where a long opening sentence can be cut without losing the gist.
const CLAUSE_BREAK = /\s*(?:[,;:()،؛]|\s[—–-]\s|\s(?:because|but|although|though|since|which|so that|and then|when|while|after|before)\s)\s*/i;

// Words a title shouldn't end on.
const DANGLING = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'from', 'by', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'is', 'was', 'are', 'that', 'this', 'so', 'if', 'as', 'very', 'really', 'just', 'i', 'like', 'not', 'be', 'و', 'في', 'من', 'على', 'إلى', 'عن', 'مع', 'أن']);

const words = (s) => s.split(/\s+/).filter(Boolean);
const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export function generateTitle(body) {
  const text = String(body || '').replace(/https?:\/\/\S+/g, ' ').trim();
  if (!text) return '';
  const firstLine = text.split('\n').find((l) => /[\p{L}\p{N}]/u.test(l)) || '';
  // The first sentence that says something.
  const sentences = firstLine.split(/(?<=[.!?؟…])\s+/);
  let t = sentences.find((s) => words(s).length >= 2) || sentences[0] || '';
  for (let prev; prev !== t;) { prev = t; t = t.replace(FILLER, ''); }
  if (!/[\p{L}\p{N}]/u.test(t)) t = firstLine;

  if (words(t).length > MAX_WORDS) {
    const head = t.split(CLAUSE_BREAK)[0];
    if (words(head).length >= 2) t = head;
  }
  let w = words(t).slice(0, MAX_WORDS);
  while (w.length > 2 && DANGLING.has(bare(w[w.length - 1]))) w.pop();
  t = w.join(' ').replace(/^[^\p{L}\p{N}"'“‘]+/u, '').replace(/[\s.,;:!?…—–\-،؛؟]+$/u, '');
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
