// Gestures on lines: swipe right to mark done; swipe left to show Tomorrow and Delete, or swipe all the
// way to delete; long-press (or drag with a mouse) to move a line and its sub-items anywhere, including
// other days. A long press let go without moving selects the line (see select.js); dragging a selected
// line moves all the selected lines.
// Touch uses touch events rather than pointer events: iOS cancels pointer events when a long press
// turns into a move, but lets a touchmove listener take over the move from scrolling.
import { state, tx, update, block, linesOf, moveBlock, tidy } from './store.js';
import { clock, fitTime, withTime, hhmm } from './parse.js';
import { main, ui } from './view.js';
import { toggleDone, removeWithUndo, moveNext, nextAction } from './menus.js';
import { pick, chosen, endSelect } from './select.js';
import { h, toast } from './ui.js';

// FLICK: px per ms. BUTTON: width of each button a left swipe shows.
const LONG_PRESS = 350, SLOP = 10, SWIPE = 72, FLICK = 0.45, BUTTON = 80, EDGE_TOP = 90, EDGE_BOTTOM = 70;
let g = null;          // the gesture in progress
let open = null;       // the line swiped open to show its buttons: { row, bg, slide }
let swallow = false;   // eat the click that follows a gesture

export const consumeClick = () => { const s = swallow; swallow = false; return s; };

// A touch or click anywhere but on a line's open buttons closes them, and does nothing else.
// (On that line itself, the gesture decides: a tap closes, a swipe moves them.)
function closeOpen(e) {
  swallow = false;
  if (!open || open.bg.contains(e.target) || open.row.contains(e.target)) return;
  shut();
  swallow = true;
}
document.addEventListener('touchstart', closeOpen, { capture: true, passive: true });
document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') closeOpen(e); }, true);

// The buttons on a line swiped open.
main.addEventListener('click', e => {
  const b = e.target.closest('[data-sw]');
  if (!b) return;
  e.stopPropagation();
  const l = state.lines.get(b.closest('.ln').dataset.id);
  shut();
  if (l) (b.dataset.sw === 'delete' ? removeWithUndo : moveNext)(block(l));
}, true);

// The row a gesture can start on: not the line being edited, not read-only, not a button or link.
function rowAt(target) {
  const row = target.closest?.('.ln');
  return row && !row.classList.contains('ed') && !row.closest('.ro') && !target.closest('button, a') ? row : null;
}

function begin(row, x, y, touch) {
  g = { row, x0: x, y0: y, x, y, mode: null, touch };
  if (touch && !row.classList.contains('mir') && open?.row !== row) g.timer = setTimeout(startDrag, LONG_PRESS);
}

main.addEventListener('touchstart', e => {
  if (g) return finish(false);   // a second finger cancels
  const row = rowAt(e.target), t = e.touches[0];
  if (row && e.touches.length === 1) begin(row, t.clientX, t.clientY, true);
}, { passive: true });

// Once a swipe or drag has started, the page must not scroll under the finger.
document.addEventListener('touchmove', e => {
  if (!g?.touch) return;
  const t = e.touches[0];
  move(t.clientX, t.clientY);
  if (g?.mode && e.cancelable) e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', e => {
  if (!g?.touch) return;
  const acted = !!g.mode;
  finish(true);
  if (acted && e.cancelable) e.preventDefault();   // no tap after a swipe or drag
}, { passive: false });
document.addEventListener('touchcancel', () => { if (g?.touch) finish(false); });

main.addEventListener('pointerdown', e => {
  const row = e.pointerType === 'mouse' && !e.button && rowAt(e.target);
  if (row) begin(row, e.clientX, e.clientY, false);
});
addEventListener('pointermove', e => { if (g && !g.touch && !g.wheel) move(e.clientX, e.clientY); });
addEventListener('pointerup', () => { if (g && !g.touch && !g.wheel) finish(true); });

// Trackpad: a sideways two-finger swipe over a line works like a touch swipe, as in Mail on the Mac.
// macOS reports it as sideways scrolling; with natural scrolling the numbers are reversed, which Safari
// says through webkitDirectionInvertedFromDevice (other browsers assume the macOS default).
// The swipe ends when the scrolling stops; the drift that follows a swipe is swallowed.
let wheelEnd = 0, drift = 0;
main.addEventListener('wheel', e => {
  const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY), now = performance.now();
  if (!g?.wheel) {
    if (!sideways || g || ui.sel) return;
    if (now < drift) { drift = now + 200; return e.preventDefault(); }
    const row = rowAt(e.target);
    if (!row) return;
    g = { row, x0: 0, y0: 0, x: 0, y: 0, mode: null, touch: false, wheel: true, d: 0 };
    startSwipe();
  }
  e.preventDefault();   // no page scroll, and no Back/Forward navigation
  swipeTo(g.d -= e.deltaX * (e.webkitDirectionInvertedFromDevice === false ? -1 : 1));
  clearTimeout(wheelEnd);
  wheelEnd = setTimeout(() => { drift = performance.now() + 200; finish(true); }, 200);
}, { passive: false });

// No text selection or callout menu on lines that aren't being edited, so a long press stays ours.
main.addEventListener('contextmenu', e => { if (g?.mode || rowAt(e.target)) e.preventDefault(); });
main.addEventListener('selectstart', e => { if (rowAt(e.target.parentElement ?? e.target)) e.preventDefault(); });

function move(x, y) {
  g.x = x;
  g.y = y;
  const dx = x - g.x0, dy = y - g.y0;
  if (!g.mode) {
    if (Math.hypot(dx, dy) < SLOP) return;
    clearTimeout(g.timer);
    if (Math.abs(dx) > Math.abs(dy) * 1.2 && !ui.sel) startSwipe();   // no swiping in select mode
    else if (!g.touch && !g.row.classList.contains('mir')) startDrag();
    else { if (open?.row === g.row) shut(); g = null; return; }   // a vertical touch move before the long press is a scroll
  }
  if (g.mode === 'swipe') swipeTo(dx);
  else {
    if (Math.hypot(x - g.liftX, y - g.liftY) > SLOP) g.shifted = true;
    dragTo();
  }
}

function finish(ok) {
  const s = g;
  g = null;
  clearTimeout(s.timer);
  if (!s.mode) {   // a tap on a line with its buttons open closes them
    if (open?.row === s.row) { shut(); swallow = true; }
    return;
  }
  if (!s.touch) { swallow = true; setTimeout(() => { swallow = false; }, 60); }
  if (s.mode === 'swipe') endSwipe(s, ok); else endDrag(s, ok);
}

// ---- Swipe ----

// Right slides the line over to mark it done. Left brings in the line's buttons, Tomorrow (the line's
// next day) and Delete, over its right end (lines are short, so the text stays in view); they stay until
// a tap, and a long swipe left deletes at once, as in Mail. Swiping an open line starts where it is.
function startSwipe() {
  g.mode = 'swipe';
  const l = state.lines.get(g.row.dataset.id), again = open?.row === g.row ? open : null;
  if (open && !again) shut();
  open = null;
  clearTimeout(g.row.settled);
  g.row.classList.add('swiping');
  g.row.classList.remove('settle');
  g.bg = again?.bg ?? g.row.appendChild(h('div', { className: 'sw' }));
  g.slide = [...g.row.children].filter(el => el !== g.bg);   // moved directly, so only they restyle
  g.base = again ? again.base : 0;
  g.trail = [];
  g.next = l && !g.row.classList.contains('mir') ? nextAction([l]) : null;   // From Later copies keep their date
  g.reveal = BUTTON * (g.next ? 2 : 1);
  g.full = Math.min(Math.max(g.reveal + 60, g.row.offsetWidth * 0.6), 280);   // a long swipe, short enough for a trackpad
}

// d: how far the finger (or trackpad) has moved sideways since the swipe started.
function swipeTo(d) {
  const x = g.base ? Math.min(0, g.base + d) : d;   // an open line only closes to the right
  g.dx = x;
  g.trail.push([performance.now(), x]);
  if (g.trail.length > 6) g.trail.shift();
  for (const el of g.slide) el.style.transform = x > 0 ? `translateX(${x}px)` : '';
  paintSwipe(g, x);
}

// The strip beside the line: Done (green once far enough), or the buttons (all Delete past a long swipe).
function paintSwipe(s, x) {
  const side = x > 0 ? 'r' : 'l';
  if (s.bg.dataset.side !== side) {
    s.bg.dataset.side = side;
    s.bg.replaceChildren(...(side === 'r' ? [h('span', {}, state.lines.get(s.row.dataset.id)?.done ? 'Not done' : 'Done')] : [
      s.next && h('button', { className: 'sa next', 'data-sw': 'next' }, s.next.label),
      h('button', { className: 'sa del', 'data-sw': 'delete' }, 'Delete'),
    ].filter(Boolean)));
  }
  s.bg.className = `sw ${side}${(side === 'r' ? x > SWIPE : -x > s.full) ? ' go' : ''}`;
  s.bg.style.width = `${Math.abs(x)}px`;
}

// Finger speed over the last 80 ms, in px per ms (negative is leftward).
function speed(s) {
  const [t1, x1] = s.trail.at(-1) ?? [0, 0];
  const [t0, x0] = s.trail.find(([t]) => t1 - t < 80) ?? [t1, x1];
  return t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
}

// A right swipe acts when it goes far enough, or when it's a quick flick. Either way the finger has to
// be moving outward as it lets go: pulling back cancels, as in iOS.
function commits(s) {
  const v = speed(s);
  if (s.wheel) return s.dx > SWIPE;
  if (v < -0.05) return false;
  return s.dx > SWIPE || (s.dx > 24 && v > FLICK);
}

// Where a left swipe ends: past a long swipe it deletes; a flick left opens the buttons and a pull back
// closes them; otherwise they stay open if more than half of them showed.
function landing(s) {
  if (-s.dx > s.full) return 'delete';
  const v = s.wheel ? 0 : speed(s);
  if (v < -FLICK && s.dx < -24) return 'open';
  if (v > 0.05) return 'close';
  return -s.dx > s.reveal / 2 ? 'open' : 'close';
}

function endSwipe(s, ok) {
  const l = state.lines.get(s.row.dataset.id), x = s.dx ?? 0;
  const to = !ok || !l ? 'close' : x > 0 ? (commits(s) ? 'done' : 'close') : landing(s);
  settle(s, to === 'open' ? -s.reveal : 0);
  if (to === 'done') toggleDone(l);
  else if (to === 'delete') removeWithUndo(block(l));
}

// Settles the line at x: 0 closes it, -reveal leaves its buttons open.
function settle(s, x) {
  s.row.classList.add('settle');
  for (const el of s.slide) el.style.transform = '';
  s.bg.style.width = `${-x}px`;
  if (x) {
    s.bg.className = 'sw l';
    open = { row: s.row, bg: s.bg, slide: s.slide, base: x };
    return;
  }
  s.row.settled = setTimeout(() => { s.row.classList.remove('swiping', 'settle'); s.bg.remove(); }, 200);
}

function shut() {
  const s = open;
  open = null;
  if (s) settle(s, 0);
}

// ---- Drag ----

// In select mode the pressed line joins the selection, and all of it moves.
function startDrag() {
  const l = state.lines.get(g.row.dataset.id);
  if (!l) return;
  shut();
  g.mode = 'drag';
  if (ui.sel) pick(l.id);
  g.blk = ui.sel ? chosen() : block(l);
  g.ids = new Set(g.blk.map(x => x.id));
  const r = g.row.getBoundingClientRect();
  g.grab = g.y0 - r.top;
  g.liftX = g.x;
  g.liftY = g.y;
  g.ghost = g.row.cloneNode(true);
  g.ghost.classList.add('ghost');
  g.ghost.classList.remove('nowb');
  Object.assign(g.ghost.style, { width: `${r.width}px`, left: `${r.left}px` });
  if (g.blk.length > 1) g.ghost.dataset.more = `+${g.blk.length - 1}`;
  g.bar = h('div', { className: 'dropbar' });
  document.body.append(g.ghost, g.bar);
  document.body.classList.add('dragging');
  for (const row of main.querySelectorAll('.ls > .ln')) if (g.ids.has(row.dataset.id)) row.classList.add('lift');
  dragTo();
  autoScroll();
}

// Scrolls when the finger holds near the top or bottom edge, once it has moved since lifting,
// so lifting a line that already sits near an edge doesn't scroll by itself.
function autoScroll() {
  const tick = () => {
    if (g?.mode !== 'drag') return;
    if (Math.abs(g.y - g.liftY) > 24) g.moved = true;
    const v = !g.moved ? 0 : g.y < EDGE_TOP ? -(EDGE_TOP - g.y) / 5 : g.y > innerHeight - EDGE_BOTTOM ? (g.y - innerHeight + EDGE_BOTTOM) / 5 : 0;
    if (v) { scrollBy(0, v); dragTo(); }
    g.raf = requestAnimationFrame(tick);
  };
  g.raf = requestAnimationFrame(tick);
}

// Finds where the block would land: before or after the row under the finger, or at a day's start or end.
function dragTo() {
  g.ghost.style.transform = `translateY(${g.y - g.grab}px)`;
  const el = document.elementFromPoint(g.x, g.y), sec = el?.closest('section.day:not(.ro)');
  if (!sec) return;
  const row = el.closest('.ls > .ln');
  if (row && g.ids.has(row.dataset.id)) return;
  let target, y;
  if (row) {
    const r = row.getBoundingClientRect(), after = g.y > r.top + r.height / 2;
    target = { c: sec.dataset.c, id: row.dataset.id, after };
    y = after ? r.bottom : r.top;
  } else {
    const first = !sec.classList.contains('folded') && el.closest('.dh') && sec.querySelector('.ls > .ln:not(.lift)');
    target = { c: sec.dataset.c, id: first?.dataset.id ?? null, after: false };
    y = first ? first.getBoundingClientRect().top : (sec.classList.contains('folded') ? sec.firstChild : sec.querySelector('.ls')).getBoundingClientRect().bottom;
  }
  g.target = target;
  const box = sec.getBoundingClientRect();
  Object.assign(g.bar.style, { top: `${y - 1}px`, left: `${box.left}px`, width: `${box.width}px` });
}

function endDrag(s, ok) {
  cancelAnimationFrame(s.raf);
  s.ghost.remove();
  s.bar.remove();
  document.body.classList.remove('dragging');
  main.querySelectorAll('.lift').forEach(r => r.classList.remove('lift'));
  if (ok && s.touch && !s.shifted) return pick(s.row.dataset.id);   // a long press let go in place selects
  if (!ok || !s.target) return;
  const { c, id, after } = s.target, list = linesOf(c).filter(l => !s.ids.has(l.id));
  let i = list.length;
  if (id) {
    i = list.findIndex(l => l.id === id);
    if (after) { const t = list[i]; i += t.fold ? block(t).filter(l => !s.ids.has(l.id)).length : 1; }
  }
  // Keep the indent the block had, within what the drop spot allows: at most one level under the
  // line above, and at least the indent of a sub-list it lands inside.
  const prev = list[i - 1], next = list[i];
  const lo = prev && next && next.ind > 0 && prev.ind >= next.ind ? next.ind : 0, hi = prev ? prev.ind + 1 : 0;
  const selected = !!ui.sel;
  tx(() => { moveBlock(s.blk, c, i, Math.min(Math.max(s.blk[0].ind, lo), hi)); for (const x of new Set([...s.blk.map(l => l.c), c])) tidy(x); });
  if (selected) endSelect();
  else offerTime(s.blk[0].id, s.ids);
}

// A dropped line whose time no longer fits between the nearest times above and below it gets a
// suggested time halfway between them. Nothing changes unless the button is tapped.
function offerTime(id, moved) {
  const l = state.lines.get(id), t = clock(l.text);
  if (t == null) return;
  const list = linesOf(l.c), i = list.findIndex(x => x.id === id);
  const near = dir => {
    for (let j = i + dir; j >= 0 && j < list.length; j += dir) {
      const m = moved.has(list[j].id) ? null : clock(list[j].text);
      if (m != null) return m;
    }
    return null;
  };
  const s = fitTime(near(-1), t, near(1));
  if (s == null) return;
  toast(`Change ${hhmm(t)} to ${hhmm(s)}?`, () => tx(() => update(state.lines, id, { text: withTime(state.lines.get(id).text, s) })), 'Change', 8000);
}
