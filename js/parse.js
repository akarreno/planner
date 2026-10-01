// Planner shorthand: how the text of a line is read. Pure functions, no DOM or state.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Month by its first three letters, English or Spanish.
const MONTH = { jan: 0, ene: 0, feb: 1, mar: 2, apr: 3, abr: 3, may: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, oct: 9, nov: 10, dec: 11, dic: 11 };
const monthOf = s => MONTH[s.slice(0, 3).toLowerCase()];

// ---- Dates: ISO strings (YYYY-MM-DD) in local time ----

const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = s => new Date(+s.slice(0, 4), s.slice(5, 7) - 1, +s.slice(8, 10));
export const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const today = (now = new Date()) => iso(now);
export const weekday = s => WEEKDAYS[fromIso(s).getDay()];
export const dayTitle = s => { const d = fromIso(s); return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
// Section headers: full weekday, short month, so it fits a phone next to the Today label.
export const headTitle = s => { const d = fromIso(s); return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
export const shortDay = s => { const d = fromIso(s); return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
export const clockLabel = (now = new Date()) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;
export const nowMinutes = (now = new Date()) => now.getHours() * 60 + now.getMinutes();

// Without a year, a date more than 90 days back means next year.
function makeDate(year, month, day, base) {
  if (month == null) return null;
  let y = year || +base.slice(0, 4);
  if (!year && iso(new Date(y, month, day)) < addDays(base, -90)) y++;
  const d = new Date(y, month, day);
  return d.getMonth() === month && d.getDate() === day ? iso(d) : null;
}

const DATE_END = String.raw`(?=[\s:,.\-–—]|$)`;
// "Nov 6", "Monday, November 10", "Oct 14 2027"
const MONTH_DAY = new RegExp(String.raw`^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?([a-záéíóú]{3,})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?${DATE_END}`, 'i');
// "2027-07-10", "2027‑July‑10"
const YEAR_MONTH_DAY = new RegExp(String.raw`^(\d{4})[-‑–/]([a-z]{3,}|\d{1,2})[-‑–/](\d{1,2})${DATE_END}`, 'i');

function dateAt(s, base) {
  let m = MONTH_DAY.exec(s), d = m && makeDate(+m[3] || 0, monthOf(m[1]), +m[2], base);
  if (!d && (m = YEAR_MONTH_DAY.exec(s))) d = makeDate(+m[1], /\d/.test(m[2]) ? m[2] - 1 : monthOf(m[2]), +m[3], base);
  return d ? { iso: d, len: m[0].length } : null;
}

// ---- One line ----

// Optional marker ("—", "≈", "<", ">"), then an optional time or range: "≈ 15:30", "11:30 - 12:30", "18:30 to 20:00".
const HEAD = /^([—–]\s*|[≈~<>]\s*)?(?:(\d{1,2}:\d{2})(?:\s*(?:-|–|to)\s*(\d{1,2}:\d{2}))?(?=\s|$))?/;
// A link written as [label](address), "(?)", or a bare web address.
const INLINE = /\[([^[\]\n]+)\]\(([^()\s]+)\)|\(\?\)|https?:\/\/\S+/g;
export const NUMBERED = /^\d+[.)]\s/;
const minutes = s => { const i = s.indexOf(':'); return s.slice(0, i) * 60 + +s.slice(i + 1); };

// Text styles: **bold**, *italic*, __underline__, ~~strikethrough~~, and highlights, =={pink}like this==
// in one of five colors. A marker opens before a non-space and closes after one, so "5 * 3" and "a == b"
// stay as typed; a marker without a partner is plain text.
export const COLORS = ['purple', 'pink', 'orange', 'mint', 'blue'];
const STYLE = { '**': 'b', '*': 'i', '__': 'u', '~~': 's', '==': 'h' };
const MARK = Object.fromEntries(Object.entries(STYLE).map(([m, f]) => [f, m]));
const RUN = new RegExp(String.raw`\*{1,3}|__|~~|==(?:\{(${COLORS.join('|')})\})?`, 'g');

// The line from index `from` on, as pieces with their index `at`: links and the like, paired style
// markers (k 'f', with their kind `m`, a highlight's `color`, and their `mate`), and plain text.
function pieces(text, from) {
  const out = [];
  const plain = (a, b) => {
    let p = a;
    for (const r of text.slice(a, b).matchAll(RUN)) {
      const at = a + r.index, run = r[0];
      if (at > p) out.push({ k: '', s: text.slice(p, at), at: p });
      const open = /\S/.test(text[at + run.length] ?? ''), close = !r[1] && /\S/.test(text[at - 1] ?? '');
      // "***" is bold and italic: inner marker next to the text, so it closes first.
      let q = at;
      for (const s of run === '***' ? (open && !close ? ['**', '*'] : ['*', '**']) : [run]) {
        out.push({ k: 'f', s, m: s.slice(0, 2) === '==' ? '==' : s, color: r[1], at: q, open, close });
        q += s.length;
      }
      p = at + run.length;
    }
    if (p < b) out.push({ k: '', s: text.slice(p, b), at: p });
  };
  let j = from;
  for (const m of text.slice(from).matchAll(INLINE)) {
    const at = from + m.index;
    plain(j, at);
    out.push(m[1] ? { k: 'l', s: m[0], label: m[1], href: safeUrl(m[2]), at } : { k: m[0] === '(?)' ? 'q' : 'u', s: m[0], at });
    j = at + m[0].length;
  }
  plain(j, text.length);
  // A closing marker pairs with the nearest open one of the same kind that has text between them.
  const stack = [];
  for (const p of out) {
    if (p.k !== 'f') continue;
    const k = stack.findLastIndex(o => o.m === p.m);
    if (p.close && k >= 0 && p.at > stack[k].at + stack[k].s.length) { stack[k].mate = p; p.mate = stack[k]; stack.length = k; }
    else if (p.open) stack.push(p);
  }
  for (const p of out) if (p.k === 'f' && !p.mate) p.k = '';
  return out;
}

// Length of a line's head: its marker, time or date, and the spaces after them.
function headLength(text, base) {
  const h = HEAD.exec(text);
  let i = h[0].length;
  if (!h[2]) i += dateAt(text.slice(i), base)?.len ?? 0;
  while (/\s/.test(text[i] ?? '')) i++;
  return i;
}

// The parts of a line for display, as { k, s } pieces whose s join back to the exact line.
// k: 'm' marker, 't' time, 'd' date, 'q' "(?)", 'u' bare web address, 'l' [label](address) (with label
// and a safe href), 'f' a style marker (not shown), '' plain text. f lists the styles in effect (b i u s)
// and hl the highlight color.
export function segments(text, base = today()) {
  const out = [], h = HEAD.exec(text);
  let i = 0;
  if (h[1]) { out.push({ k: 'm', s: h[1] }); i = h[1].length; }
  if (h[2]) { out.push({ k: 't', s: h[0].slice(i) }); i = h[0].length; }
  else { const d = dateAt(text.slice(i), base); if (d) { out.push({ k: 'd', s: text.slice(i, i + d.len) }); i += d.len; } }
  const on = { b: 0, i: 0, u: 0, s: 0 }, colors = [];
  for (const p of pieces(text, i)) {
    if (p.k === 'f') {
      const opens = p.mate.at > p.at;
      if (p.m === '==') { if (opens) colors.push(p.color ?? COLORS[0]); else colors.pop(); }
      else on[STYLE[p.m]] += opens ? 1 : -1;
      out.push({ k: 'f', s: p.s });
      continue;
    }
    const seg = p.k === 'l' ? { k: 'l', s: p.s, label: p.label, href: p.href } : { k: p.k, s: p.s };
    const f = Object.keys(on).filter(x => on[x] > 0).join('');
    if (f) seg.f = f;
    if (colors.length) seg.hl = colors.at(-1);
    const last = out.at(-1);
    if (seg.k === '' && last?.k === '' && last.f === seg.f && last.hl === seg.hl) last.s += seg.s; else out.push(seg);
  }
  return out;
}

// The styles in effect at a position in the line: { f: like "bi", hl: a color or undefined }.
export function stylesAt(text, pos) {
  let r = 0;
  for (const seg of segments(text)) {
    r += seg.s.length;
    if (seg.k !== 'f' && pos < r) return { f: seg.f ?? '', hl: seg.hl };
  }
  return { f: '', hl: undefined };
}

// Turns a style on or off for the selection [start, end); with nothing selected, for the whole line after
// its time or date. Inside text that already has the style, it removes it from that whole stretch; inside
// a highlight of another color, it changes the color. flag: b i u s, or h with a color.
// Returns { text, start, end } with the new selection, or null when there's nothing to style.
export function toggleStyle(text, start, end, flag, color) {
  const head = headLength(text, today()), mark = flag === 'h' ? `=={${color}}` : MARK[flag], kind = MARK[flag];
  let s = Math.max(start, head), e = Math.max(end, head);
  if (s === e) { s = head; e = text.length; }
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s >= e) return null;
  for (const p of pieces(text, head)) {
    if (p.k !== 'f' || p.m !== kind || p.mate.at < p.at) continue;
    const a = p.at + p.s.length, b = p.mate.at, z = b + p.mate.s.length;
    if (s < p.at || e > z) continue;
    if (flag === 'h' && (p.color ?? COLORS[0]) !== color) {   // another color: recolor the stretch
      const d = mark.length - p.s.length;
      return { text: text.slice(0, p.at) + mark + text.slice(a), start: s < a ? s : s + d, end: e + d };
    }
    const shift = x => (x <= p.at ? x : x <= a ? p.at : x <= b ? x - p.s.length : b - p.s.length);
    return { text: text.slice(0, p.at) + text.slice(a, b) + text.slice(z), start: shift(s), end: shift(e) };
  }
  return { text: text.slice(0, s) + mark + text.slice(s, e) + kind + text.slice(e), start: s + mark.length, end: e + mark.length };
}

// ---- Links ----

// An address that is fine to open: web addresses and app links (applenotes:, shortcuts:, mailto: …),
// never script or data addresses. "www.example.com" gets https:// in front. Anything else gives null.
export function safeUrl(u) {
  u = u.trim();
  if (/^(javascript|data|vbscript|file|blob):/i.test(u)) return null;
  if (/^[a-z][a-z0-9+.-]*:\S+$/i.test(u)) return u;
  if (/^www\.\S+$/i.test(u)) return 'https://' + u;
  return null;
}

// Does pasted text look like an address, so that pasting it over selected text should link that text?
export const isUrl = s => /^(?:https?:\/\/|www\.|[a-z][a-z0-9+.-]*:\/\/|(?:mailto|tel|sms|facetime|applenotes|mobilenotes|shortcuts):)\S+$/i.test(s.trim()) && !!safeUrl(s);

// The line text for a link: [label](address), with characters that would end the address early encoded.
const ESCAPE = { '(': '%28', ')': '%29' };
export const linkText = (label, url) => `[${label.replace(/[[\]]/g, '')}](${url.trim().replace(/[()\s]/g, c => ESCAPE[c] ?? '%20')})`;

// The link at a position in a line's text, if any: { start, end, label, url }.
export function linkAt(text, pos) {
  for (const m of text.matchAll(/\[([^[\]\n]+)\]\(([^()\s]+)\)/g)) {
    if (pos >= m.index && pos <= m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, label: m[1], url: m[2] };
  }
  return null;
}

// Puts links copied from Notes back into its plain text: each anchor's text, in document order, becomes
// [text](address). Anchors whose text is the address itself are left alone, since bare addresses already work.
export function linkify(text, anchors) {
  let out = '', i = 0;
  for (const { label, href } of anchors) {
    const t = label.trim();
    if (!t || t === href.trim() || /[[\]\n]/.test(t) || !safeUrl(href)) continue;
    const j = text.indexOf(t, i);
    if (j < 0) continue;
    out += text.slice(i, j) + linkText(t, href);
    i = j + t.length;
  }
  return out + text.slice(i);
}

// Start time of a line in minutes, or null: "≈ 15:30 Coffee" → 930.
export function clock(text) { const h = HEAD.exec(text); return h[2] ? minutes(h[2]) : null; }

// Date a line starts with, or null: "Nov 6: Ask…" → "2026-11-06".
export function leadDate(text, base = today()) { const h = HEAD.exec(text); return h[2] ? null : dateAt(text.slice(h[0].length), base)?.iso ?? null; }

// ---- Times after moving a line ----

// Time b on a line below time a, in minutes: an early-morning time (before 06:00) more than 6 hours
// before a counts as after midnight, like "< 01:00 Sleep" after "19:00 Dinner".
export const afterMidnight = (a, b) => (a != null && b != null && b < 360 && b < a - 360 ? b + 1440 : b);

export const hhmm = m => `${pad(Math.floor((m % 1440 + 1440) % 1440 / 60))}:${pad((m % 60 + 60) % 60)}`;

// A time for a line that now sits between two timed lines, or null when its own time already fits.
// prev and next are the start times of the nearest timed lines above and below (null if none).
// The suggestion is halfway between the neighbours: rounded to 5 minutes when they're 10 or more apart.
export function fitTime(prev, t, next) {
  const p = prev, tt = afterMidnight(p, t), n = afterMidnight(p ?? tt, next);
  if ((p == null || tt >= p) && (n == null || tt <= n)) return null;
  let s;
  if (p != null && n != null) { const gap = n - p; s = gap >= 10 ? Math.round((p + gap / 2) / 5) * 5 : Math.floor(p + gap / 2); }
  else s = p != null ? p + 30 : n - 30;
  return (s % 1440 + 1440) % 1440;
}

// The line with its start time set to m. A range keeps its length; markers like ≈ and < stay.
export function withTime(text, m) {
  const h = HEAD.exec(text);
  if (!h[2]) return text;
  const mark = h[1] ?? '', start = minutes(h[2]), sep = h[0].slice(mark.length + h[2].length, h[0].length - (h[3]?.length ?? 0));
  return mark + hhmm(m) + sep + (h[3] ? hhmm(minutes(h[3]) + m - start) : '') + text.slice(h[0].length);
}

// 'blank', 'head' (ends with a colon, like "WR:" or "@ Home:") or ''.
export function kind(text) { const t = text.trim(); return !t ? 'blank' : t.endsWith(':') ? 'head' : ''; }

// ---- Pasted text ----

const LEAD = /^[\t ]*/;
const BULLET = /^(?:[⁃•◦▪‣*-][\t ]+)+/;
const LIST_NUMBER = /^(\d+)[.)][\t ]+/;

// Splits text into lines with an indent level. Understands tabs and bullets from Notes,
// numbered lists that restart at "1." for a nested list, and "Header:" lines, whose block sits under them.
export function parseLines(text) {
  const rows = [];
  let nums = [], prevNum = -1, head = -1;   // nums[depth] = last list number at that depth
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const lead = LEAD.exec(raw)[0];
    let t = raw.slice(lead.length).trimEnd();
    let ind = (lead.match(/\t/g)?.length ?? 0) + Math.floor(lead.replace(/\t/g, '').length / 2);
    const b = BULLET.exec(t);
    if (b) { t = t.slice(b[0].length); ind = Math.max(ind, 1); }
    const n = !b && LIST_NUMBER.exec(t);
    if (n) {
      const num = +n[1];
      t = `${num}. ${t.slice(n[0].length)}`;
      if (num === 1 && prevNum >= ind) ind = prevNum + 1;
      else if (num > 1) { const d = nums.lastIndexOf(num - 1); if (d >= 0) ind = d; }
      nums[ind] = num;
      nums.length = ind + 1;
      prevNum = ind;
    } else { nums = []; prevNum = -1; }
    if (!t) head = -1;
    else if (head >= 0 && ind <= head) { if (t.endsWith(':')) head = -1; else ind = head + 1; }
    if (t.endsWith(':')) head = ind;
    rows.push({ text: t, ind: t ? ind : 0 });
  }
  return rows;
}

const trimBlank = rows => {
  let a = 0, b = rows.length;
  while (a < b && !rows[a].text) a++;
  while (b > a && !rows[b - 1].text) b--;
  return rows.slice(a, b);
};

const DAY_HEADER = /^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),?\s+([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i;
const WEEKDAY_ONLY = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i;

// A whole planner note: "Thursday October 1" starts a day, "Later:" starts the Later list,
// and lines before the first day belong to `first`.
export function importNote(text, { base, first = base }) {
  const days = new Map(), later = [];
  let target = first, chunk = [];
  const flush = () => {
    const rows = trimBlank(parseLines(chunk.join('\n')));
    chunk = [];
    if (!rows.length) return;
    if (target === 'later') later.push(...rows);
    else days.set(target, [...(days.get(target) ?? []), ...rows]);
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.trim(), m = DAY_HEADER.exec(t);
    const date = m && makeDate(+m[3] || 0, monthOf(m[1]), +m[2], base);
    if (date) { flush(); target = date; }
    else if (/^later:?$/i.test(t)) { flush(); target = 'later'; }
    else chunk.push(raw);
  }
  flush();
  return { days: [...days].map(([date, lines]) => ({ date, lines })).sort((a, b) => a.date.localeCompare(b.date)), later };
}

// A weekly template: a bare weekday name ("Monday") starts each template.
export function importTemplates(text) {
  const out = [];
  let name = null, chunk = [];
  const flush = () => { if (name) out.push({ name, lines: trimBlank(parseLines(chunk.join('\n'))) }); chunk = []; };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.trim();
    if (WEEKDAY_ONLY.test(t)) { flush(); name = t[0].toUpperCase() + t.slice(1).toLowerCase(); }
    else if (name) chunk.push(raw);
  }
  flush();
  return out;
}

// Back to Notes-style text: a title line, then the lines, with tabs and "- " for sub-items.
export const exportText = blocks => blocks.map(({ title, lines }) => [title, ...lines.map(l =>
  l.ind && l.text ? '\t'.repeat(l.ind) + (NUMBERED.test(l.text) ? '' : '- ') + l.text : l.text)].join('\n')).join('\n\n');
