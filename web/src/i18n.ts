// Interface languages: Traditional Chinese (the source text), Simplified
// Chinese (derived from it: mainland terms first, then characters) and
// English (written next to each Traditional string: tr('繁體', 'English')).
// The demo page stays in Traditional Chinese; the IDE picks the language.

import { HANS_CHARS, HANS_PHRASES } from './i18n_hans';

export type Lang = 'zh-Hant' | 'zh-Hans' | 'en';
export const LANGS: [Lang, string][] = [['zh-Hant', '繁體中文'], ['zh-Hans', '简体中文'], ['en', 'English']];

let cur: Lang = 'zh-Hant';

export function lang(): Lang { return cur; }
export function setLang(l: Lang): void { cur = l; }

/** the language of a browser locale such as "zh-TW", "zh-CN" or "en-US" */
export function fromLocale(loc: string | undefined): Lang {
  const l = (loc ?? '').toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(l)) return 'zh-Hant';
  if (l.startsWith('zh')) return 'zh-Hans';
  return l ? 'en' : 'zh-Hant';
}

/** `hant` in the current language (`en` for English) */
export function tr(hant: string, en: string): string {
  return cur === 'en' ? en : cur === 'zh-Hans' ? hans(hant) : hant;
}

const cache = new Map<string, string>();
let phraseRe: RegExp | null = null;

/** Traditional -> Simplified Chinese (mainland terms) */
export function hans(s: string): string {
  let r = cache.get(s);
  if (r !== undefined) return r;
  phraseRe ??= new RegExp(Object.keys(HANS_PHRASES).sort((a, b) => b.length - a.length).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  r = s.replace(phraseRe, m => HANS_PHRASES[m]);
  let out = '';
  for (const ch of r) out += HANS_CHARS[ch] ?? ch;
  cache.set(s, out);
  return out;
}

/**
 * Translate a page's static text: elements with data-en get their English
 * text (data-en-html: English HTML), data-en-title / data-en-ph their title
 * and placeholder; for Simplified Chinese every text node, title and
 * placeholder is converted.
 */
export function translateDom(root: HTMLElement): void {
  document.documentElement.lang = cur;
  if (cur === 'zh-Hant') return;
  if (cur === 'en') {
    for (const el of root.querySelectorAll<HTMLElement>('[data-en]')) el.textContent = el.dataset.en!;
    for (const el of root.querySelectorAll<HTMLElement>('[data-en-html]')) el.innerHTML = el.dataset.enHtml!;
    for (const el of root.querySelectorAll<HTMLElement>('[data-en-title]')) el.title = el.dataset.enTitle!;
    for (const el of root.querySelectorAll<HTMLInputElement>('[data-en-ph]')) el.placeholder = el.dataset.enPh!;
    return;
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[㐀-鿿]/.test(n.nodeValue!)) n.nodeValue = hans(n.nodeValue!);
  for (const el of root.querySelectorAll<HTMLElement>('[title]')) el.title = hans(el.title);
  for (const el of root.querySelectorAll<HTMLInputElement>('[placeholder]')) el.placeholder = hans(el.placeholder);
}
