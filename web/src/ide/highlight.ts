// Veryl syntax highlighting: source text -> HTML lines (one string per line).

const KEYWORDS = new Set(('module interface package function import export inst param const var let assign always_ff always_comb '
  + 'initial final if else if_reset case switch default for in rev step return break input output inout modport struct enum union '
  + 'typedef embed include generate pub proto bind connect type as repeat inside outside unsafe alias true false').split(' '));
const TYPES = new Set(('logic bit clock clock_posedge clock_negedge reset reset_async_high reset_async_low reset_sync_high reset_sync_low '
  + 'u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 signed tri string').split(' '));

const TOKEN = /(\/\/.*)|(\/\*)|("(?:\\.|[^"\\])*")|(\d+'s?[bodhBODH][0-9a-fA-FxXzZ_]+|\d+'[01xXzZ]|'[01xXzZ]|\d[\d_]*(?:\.\d+)?)|(\$[A-Za-z_]\w*)|(#\[[^\]]*\])|([A-Za-z_]\w*)|('[a-z_]\w*)/g;

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** HTML for each line of `src` */
export function highlight(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    let h = '';
    let i = 0;
    if (inBlock) {
      const e = line.indexOf('*/');
      if (e < 0) { out.push(`<span class="t-com">${esc(line)}</span>`); continue; }
      h += `<span class="t-com">${esc(line.slice(0, e + 2))}</span>`;
      i = e + 2;
      inBlock = false;
    }
    TOKEN.lastIndex = i;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(line))) {
      h += esc(line.slice(i, m.index));
      const t = m[0];
      if (m[1]) h += `<span class="t-com">${esc(t)}</span>`;
      else if (m[2]) {
        const e = line.indexOf('*/', m.index + 2);
        const end = e < 0 ? line.length : e + 2;
        h += `<span class="t-com">${esc(line.slice(m.index, end))}</span>`;
        if (e < 0) inBlock = true;
        TOKEN.lastIndex = end;
        i = end;
        if (inBlock) break;
        continue;
      } else if (m[3]) h += `<span class="t-str">${esc(t)}</span>`;
      else if (m[4]) h += `<span class="t-num">${esc(t)}</span>`;
      else if (m[5]) h += `<span class="t-sys">${esc(t)}</span>`;
      else if (m[6]) h += `<span class="t-attr">${esc(t)}</span>`;
      else if (m[7]) {
        if (KEYWORDS.has(t)) h += `<span class="t-kw">${t}</span>`;
        else if (TYPES.has(t)) h += `<span class="t-type">${t}</span>`;
        else if (/^[A-Z]/.test(t)) h += `<span class="t-name">${t}</span>`;
        else h += t;
      } else h += `<span class="t-dom">${esc(t)}</span>`;
      i = TOKEN.lastIndex;
    }
    if (i < line.length) h += esc(line.slice(i));
    out.push(h);
  }
  return out;
}
