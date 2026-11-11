import { PROGRAM, DAY_ORDER, EXERCISES } from './program.js';
import * as db from './db.js';

const app = document.getElementById('app');
const restbar = document.getElementById('restbar');
const toastEl = document.getElementById('toast');

// In-memory state. `sessions` mirrors IndexedDB; `active` is the workout in progress.
const S = { sessions: [], active: null, rest: null, ival: null, wake: null, persisted: false };

/* =========================================================
   Utilities
   ========================================================= */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toNum = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const round2 = v => Math.round(v * 100) / 100;

function fmtClock(totalSecs) {
  const s = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : m;
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}
function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDate = ts => new Date(ts).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
function relDay(ts) {
  const d = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 864e5);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return fmtDate(ts);
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 2200);
}

/* ---------- vibration alerts (no sound) ---------- */
// pulses = 2: long double buzz (rest over / work starts); 1: single short buzz (rest starts).
function alertUser(pulses = 2) {
  try {
    navigator.vibrate?.(pulses > 1 ? [400, 150, 400] : [250]);
  } catch { /* not supported */ }
}

/* ---------- screen wake lock ---------- */
async function keepAwake(on) {
  try {
    if (on && !S.wake && 'wakeLock' in navigator) {
      S.wake = await navigator.wakeLock.request('screen');
      S.wake.addEventListener('release', () => (S.wake = null));
    } else if (!on && S.wake) {
      await S.wake.release();
      S.wake = null;
    }
  } catch { /* not supported or denied */ }
}

/* =========================================================
   Persistence
   ========================================================= */
function upsertLocal(session) {
  const i = S.sessions.findIndex(s => s.id === session.id);
  if (i >= 0) S.sessions[i] = session; else S.sessions.push(session);
}
let saveTimer;
function saveActive(now = false) {
  clearTimeout(saveTimer);
  const session = S.active;
  if (!session) return;
  const doSave = () => {
    if (S.active !== session) return; // workout was saved or discarded in the meantime
    upsertLocal(session);
    db.put(session).catch(() => toast('Could not save'));
  };
  if (now) doSave(); else saveTimer = setTimeout(doSave, 300);
}

/* =========================================================
   Session model
   ========================================================= */
function stepsFor(dayId) {
  const day = PROGRAM[dayId];
  return [{ kind: 'warmup' }, ...day.blocks.map(b => ({ kind: b.type, block: b })), { kind: 'finish' }];
}

function newSession(dayId) {
  return {
    id: uid(), dayId, status: 'active', startedAt: Date.now(), finishedAt: null, step: 0,
    warmup: {}, swaps: {}, sets: {}, circuits: {}, checks: {},
  };
}

const doneSessions = () => S.sessions
  .filter(s => s.status === 'done' && s.id !== S.active?.id)
  .sort((a, b) => b.finishedAt - a.finishedAt);

const isSwapped = ex => !!S.active?.swaps[ex.id];
const exIdFor = ex => (isSwapped(ex) && ex.alt ? ex.alt.id : ex.id);

// Most recent completed sets for an exercise (by the exercise actually performed).
function lastSets(exId) {
  for (const s of doneSessions()) {
    for (const entry of Object.values(s.sets || {})) {
      if (entry.exId !== exId) continue;
      const rows = entry.rows.filter(r => r.done);
      if (rows.length) return rows;
    }
  }
  return null;
}
function lastStation(exId) {
  for (const s of doneSessions()) {
    for (const c of Object.values(s.circuits || {})) {
      const reps = c.reps?.[exId];
      if (reps && reps.some(v => v !== '' && v != null)) return { reps, level: c.levels?.[exId] };
    }
  }
  return null;
}

function blankRow(last, i) {
  const ref = last ? (last[i] || last[last.length - 1]) : null;
  return { weight: ref?.weight ?? null, reps: null, rir: null, done: false };
}

// Get (or create) the logged sets for an exercise slot in the active session.
function entryFor(ex) {
  const a = S.active;
  const exId = exIdFor(ex);
  const last = lastSets(exId);
  let e = a.sets[ex.id];
  if (!e || e.exId !== exId) {
    e = a.sets[ex.id] = { exId, count: ex.sets, rows: [] };
  }
  while (e.rows.length < e.count) e.rows.push(blankRow(last, e.rows.length));
  return { e, last };
}

function circuitFor(block) {
  const a = S.active;
  const c = a.circuits[block.id] ||= { levels: {}, reps: {} };
  for (const st of block.stations) {
    const exId = exIdFor(st);
    if (!c.reps[exId]) c.reps[exId] = Array(block.rounds).fill('');
    if (block.type === 'interval' && c.levels[exId] == null) {
      c.levels[exId] = lastStation(exId)?.level ?? 0;
    }
  }
  return c;
}

/* =========================================================
   Router
   ========================================================= */
const route = () => location.hash.replace(/^#\/?/, '');
const go = r => { location.hash = '#/' + r; };
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

function render() {
  const r = route();
  if (r === 'session' && S.active) {
    keepAwake(true);
    renderSession();
  } else {
    keepAwake(false);
    restbar.hidden = true;
    if (r.startsWith('history/')) renderHistoryDetail(r.split('/')[1]);
    else if (r === 'history') renderHistory();
    else if (r === 'settings') renderSettings();
    else renderHome();
  }
}

/* =========================================================
   Home
   ========================================================= */
function renderHome() {
  const lastOf = dayId => doneSessions().find(s => s.dayId === dayId);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  let html = `<h1>${hello}, Ella</h1><div class="greeting">${esc(fmtDate(Date.now()))} · what are we training?</div>`;

  if (S.active) {
    const day = PROGRAM[S.active.dayId];
    html += `<div class="resume">
      <div><b>${esc(day.name)} in progress</b></div>
      <div class="small muted">Started ${new Date(S.active.startedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</div>
      <div class="row">
        <button class="btn primary" style="flex:1" data-act="resume">Resume</button>
        <button class="btn ghost" data-act="discard">Discard</button>
      </div></div>`;
  }

  for (const id of DAY_ORDER) {
    const day = PROGRAM[id];
    const last = lastOf(id);
    html += `<button class="day-card" data-act="start" data-day="${id}">
      <div><div class="name">${esc(day.name)}</div>
      <div class="meta">${esc(day.subtitle)} · ${last ? 'last ' + relDay(last.finishedAt) : 'not done yet'}</div></div>
      <span class="arrow">›</span></button>`;
  }

  html += `<div class="home-links">
    <button class="btn" data-act="go" data-to="history">History</button>
    <button class="btn" data-act="go" data-to="settings">Backup</button></div>`;
  app.innerHTML = html;
}

/* =========================================================
   Session screens
   ========================================================= */
function renderSession() {
  const a = S.active;
  const day = PROGRAM[a.dayId];
  const steps = stepsFor(a.dayId);
  a.step = clamp(a.step, 0, steps.length - 1);
  const step = steps[a.step];

  let body = '';
  if (step.kind === 'warmup') body = warmupView(day);
  else if (step.kind === 'single' || step.kind === 'superset') body = liftView(step.block);
  else if (step.kind === 'circuit') body = circuitView(step.block);
  else if (step.kind === 'interval') body = intervalView(step.block);
  else if (step.kind === 'check') body = checkView(step.block);
  else if (step.kind === 'finish') body = finishView();

  const dots = steps.map((_, i) => `<i class="${i === a.step ? 'on' : i < a.step ? 'done' : ''}"></i>`).join('');
  const isLast = a.step === steps.length - 1;
  const nextLabel = a.step === steps.length - 2 ? 'Finish ›' : 'Next ›';

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" data-act="go" data-to="" aria-label="Home">⌂</button>
      <div style="text-align:center">
        <div class="title">${esc(day.name)}</div>
        <div class="sub"><span id="elapsed">${fmtClock((Date.now() - a.startedAt) / 1000)}</span> · ${a.step + 1}/${steps.length}</div>
      </div>
      <span style="width:42px"></span>
    </div>
    ${body}
    <nav class="stepnav">
      <div class="dots">${dots}</div>
      <div class="inner">
        <button class="btn" data-act="prev" ${a.step === 0 ? 'disabled' : ''}>‹ Back</button>
        ${isLast
          ? `<button class="btn primary" data-act="save">Save workout</button>`
          : `<button class="btn primary" data-act="next">${nextLabel}</button>`}
      </div>
    </nav>`;
  updateRestBar();
  updateInterval();
}

function warmupView(day) {
  const a = S.active;
  const items = day.warmup.map((w, i) => `
    <button class="check-item ${a.warmup[i] ? 'on' : ''}" data-act="warm" data-i="${i}">
      <span class="check-box">${a.warmup[i] ? '✓' : ''}</span><span>${esc(w)}</span>
    </button>`).join('');
  return `<div class="block-label">Warm-up</div><div class="card">${items}</div>`;
}

function liftView(block) {
  const tags = block.type === 'superset' ? ['A', 'B'] : [''];
  // Which set is next? Superset order: A1, B1, A2, B2...
  const entries = block.exercises.map(ex => entryFor(ex));
  let nextKey = null;
  const maxRows = Math.max(...entries.map(x => x.e.rows.length));
  outer: for (let i = 0; i < maxRows; i++) {
    for (let x = 0; x < entries.length; x++) {
      const row = entries[x].e.rows[i];
      if (row && !row.done) { nextKey = `${x}-${i}`; break outer; }
    }
  }
  const cards = block.exercises.map((ex, x) => exerciseCard(ex, x, tags[x], entries[x], nextKey)).join('');
  return `<div class="block-label">${esc(block.label)} · rest ${fmtClock(block.rest)}</div>${cards}`;
}

function setSummary(r, ex) {
  const w = r.weight == null || r.weight === '' ? 'BW' : `${r.weight}${ex?.weightLabel === 'kg assist' ? ' assist' : ''}`;
  return `${w} × ${r.reps ?? '–'}${r.rir != null ? ` @${r.rir === 4 ? '4+' : r.rir}` : ''}`;
}

function exerciseCard(ex, x, tag, { e, last }, nextKey) {
  const cur = EXERCISES[e.exId];
  const unit = cur.weightLabel || 'kg';
  const rows = e.rows.map((r, i) => {
    const l = last ? last[i] : null;
    const chips = [0, 1, 2, 3, 4].map(v =>
      `<button class="chip ${r.rir === v ? 'on' : ''}" data-act="rir" data-x="${x}" data-i="${i}" data-v="${v}">${v === 4 ? '4+' : v}</button>`).join('');
    return `<div class="set ${r.done ? 'done' : ''} ${nextKey === `${x}-${i}` ? 'next' : ''}">
      <div class="n">${i + 1}</div>
      <div class="main">
        <div class="stepper">
          <button data-act="w-" data-x="${x}" data-i="${i}" aria-label="Less weight">−</button>
          <input inputmode="decimal" data-field="weight" data-x="${x}" data-i="${i}" value="${esc(r.weight ?? '')}" placeholder="—">
          <button data-act="w+" data-x="${x}" data-i="${i}" aria-label="More weight">+</button>
        </div>
        <span class="unit">${esc(unit)}</span>
        <input class="reps-input" inputmode="numeric" data-field="reps" data-x="${x}" data-i="${i}" value="${esc(r.reps ?? '')}" placeholder="reps">
      </div>
      <div class="rir"><span class="rir-label">RIR</span>${chips}</div>
      <div class="tick"><button class="tick-btn" data-act="tick" data-x="${x}" data-i="${i}" aria-label="Set done">✓</button></div>
      <div class="last">${l ? 'Last: ' + esc(setSummary(l, cur)) : last ? '' : 'No previous session'}</div>
    </div>`;
  }).join('');

  const swapLabel = ex.alt ? `<button class="swap-btn" data-act="swap" data-x="${x}">⇄ Swap</button>` : '';
  return `<section class="card">
    <div class="ex-head">
      <div>
        ${tag ? `<span class="ex-tag">${tag}</span>` : ''}
        <h2>${esc(cur.name)}</h2>
        ${isSwapped(ex) ? `<div class="swapped-from">Swapped from ${esc(ex.name)}</div>` : ''}
        <div class="target">${ex.sets} × ${esc(ex.reps)} · RIR ${esc(ex.rir)}</div>
      </div>
      ${swapLabel}
    </div>
    ${cur.note ? `<p class="note">${esc(cur.note)}</p>` : ''}
    ${rows}
    <div class="set-actions">
      <button data-act="remove-set" data-x="${x}">− Set</button>
      <button data-act="add-set" data-x="${x}">+ Set</button>
    </div>
  </section>`;
}

function stationBlock(block, st, x, c, opts = {}) {
  const exId = exIdFor(st);
  const cur = EXERCISES[exId];
  const reps = c.reps[exId];
  const last = lastStation(exId);
  const unitLabel = block.type === 'interval' ? (cur.unit === 'secs' ? 'secs' : 'reps') : 'reps';
  const inputs = reps.map((v, r) => `
    <div data-cell="${r}-${x}"><label>R${r + 1}</label>
    <input class="reps-input" inputmode="numeric" data-circ="1" data-x="${x}" data-r="${r}" value="${esc(v)}" placeholder="${esc(st.target || unitLabel)}"></div>`).join('');
  const levelSel = cur.levels ? `<select class="level" data-level="1" data-x="${x}">
      ${cur.levels.map((lv, i) => `<option value="${i}" ${c.levels[exId] === i ? 'selected' : ''}>Level ${i + 1}: ${esc(lv)}</option>`).join('')}
    </select>` : '';
  const lastTxt = last
    ? `Last: ${last.reps.map(v => v === '' || v == null ? '–' : v).join(' · ')}${last.level != null && cur.levels ? ` (L${last.level + 1})` : ''}`
    : '';
  return `<div class="station" data-station="${x}">
    <div class="station-head">
      <div><div class="station-name">${esc(cur.name)}</div>
      <div class="small muted">${st.target ? esc(st.target) : unitLabel}${isSwapped(st) ? ' · swapped from ' + esc(st.name) : ''}</div></div>
      ${st.alt ? `<button class="swap-btn" data-act="swap-station" data-x="${x}">⇄ Swap</button>` : ''}
    </div>
    ${cur.note ? `<p class="note">${esc(cur.note)}</p>` : ''}
    ${levelSel}
    <div class="round-inputs" style="--rounds:${block.rounds}">${inputs}</div>
    ${lastTxt ? `<div class="small muted" style="margin-top:6px">${esc(lastTxt)}</div>` : ''}
  </div>`;
}

function circuitView(block) {
  const c = circuitFor(block);
  return `<div class="block-label">${esc(block.label)} · ${block.rounds} rounds</div>
    <div class="card">${block.stations.map((st, x) => stationBlock(block, st, x, c)).join('')}</div>`;
}

function intervalView(block) {
  const c = circuitFor(block);
  return `<div class="block-label">${esc(block.label)} · ${block.work}s on / ${block.rest}s off · ${block.rounds} rounds</div>
    <div class="card interval-panel" id="iv-panel">
      <div class="phase" id="iv-phase">Ready</div>
      <div class="clock" id="iv-clock">${fmtClock(block.work)}</div>
      <div class="what" id="iv-what">${esc(EXERCISES[exIdFor(block.stations[0])].name)}</div>
      <div class="round" id="iv-round">Round 1 of ${block.rounds}</div>
      <div class="controls">
        <button class="btn primary" id="iv-toggle" data-act="iv-toggle">Start</button>
        <button class="btn soft" data-act="iv-skip">Skip</button>
        <button class="btn ghost" data-act="iv-reset">Reset</button>
      </div>
    </div>
    <div class="card">${block.stations.map((st, x) => stationBlock(block, st, x, c)).join('')}</div>`;
}

function checkView(block) {
  const on = !!S.active.checks[block.id];
  return `<div class="block-label">${esc(block.label)}</div>
    <div class="card"><button class="check-item ${on ? 'on' : ''}" data-act="check" data-id="${block.id}">
      <span class="check-box">${on ? '✓' : ''}</span><span>${esc(block.label)} · ${esc(block.detail)}</span>
    </button></div>`;
}

/* ---------- summary (finish screen + history detail) ---------- */
function summarise(s) {
  let sets = 0, volume = 0;
  const lines = [];
  const day = PROGRAM[s.dayId];
  for (const block of day.blocks) {
    if (block.exercises) {
      for (const ex of block.exercises) {
        const e = s.sets?.[ex.id];
        const done = e ? e.rows.filter(r => r.done) : [];
        if (!done.length) continue;
        const cur = EXERCISES[e.exId] || ex;
        sets += done.length;
        if (cur.weightLabel !== 'kg assist') {
          volume += done.reduce((t, r) => t + (Number(r.weight) || 0) * (Number(r.reps) || 0), 0);
        }
        lines.push({ name: cur.name, detail: done.map(r => setSummary(r, cur)).join(', ') });
      }
    } else if (block.stations) {
      const c = s.circuits?.[block.id];
      if (!c) continue;
      for (const st of block.stations) {
        const exId = s.swaps?.[st.id] && st.alt ? st.alt.id : st.id;
        const reps = c.reps?.[exId];
        if (!reps || !reps.some(v => v !== '' && v != null)) continue;
        const cur = EXERCISES[exId];
        const lvl = c.levels?.[exId];
        lines.push({
          name: cur.name + (lvl != null && cur.levels ? ` (L${lvl + 1})` : ''),
          detail: reps.map(v => (v === '' || v == null ? '–' : v)).join(' · ') + (cur.unit === 'secs' ? ' s' : ''),
        });
      }
    } else if (block.type === 'check' && s.checks?.[block.id]) {
      lines.push({ name: block.label, detail: block.detail + ' ✓' });
    }
  }
  return { sets, volume: Math.round(volume), lines };
}

function summaryHTML(s, endTs) {
  const { sets, volume, lines } = summarise(s);
  return `<div class="card"><div class="stats">
      <div><b>${fmtDuration(endTs - s.startedAt)}</b><span>duration</span></div>
      <div><b>${sets}</b><span>sets</span></div>
      <div><b>${volume.toLocaleString('en-AU')}</b><span>kg volume</span></div>
    </div></div>
    <div class="card">${lines.length
      ? lines.map(l => `<div class="summary-row"><div>${esc(l.name)}</div><div class="r">${esc(l.detail)}</div></div>`).join('')
      : '<div class="empty">Nothing logged yet</div>'}</div>`;
}

function finishView() {
  return `<div class="block-label">Summary</div>${summaryHTML(S.active, Date.now())}
    <button class="btn ghost full" data-act="discard">Discard this workout</button>`;
}

/* =========================================================
   History + settings
   ========================================================= */
function renderHistory() {
  const list = doneSessions();
  app.innerHTML = `<div class="topbar"><button class="icon-btn" data-act="go" data-to="" aria-label="Home">⌂</button>
    <div class="title">History</div><span style="width:42px"></span></div>
    ${list.length ? list.map(s => {
      const { sets } = summarise(s);
      return `<button class="card hist-item" data-act="go" data-to="history/${s.id}">
        <div><div class="name">${esc(PROGRAM[s.dayId]?.name || s.dayId)}</div>
        <div class="small muted">${esc(fmtDate(s.finishedAt))} · ${fmtDuration(s.finishedAt - s.startedAt)} · ${sets} sets</div></div>
        <span class="muted">›</span></button>`;
    }).join('') : '<div class="empty">No workouts saved yet.</div>'}`;
}

function renderHistoryDetail(id) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return go('history');
  app.innerHTML = `<div class="topbar"><button class="icon-btn" data-act="go" data-to="history" aria-label="Back">‹</button>
    <div style="text-align:center"><div class="title">${esc(PROGRAM[s.dayId]?.name || s.dayId)}</div>
    <div class="sub">${esc(fmtDate(s.finishedAt))}</div></div><span style="width:42px"></span></div>
    ${summaryHTML(s, s.finishedAt)}
    <button class="btn ghost full" data-act="delete-hist" data-id="${s.id}">Delete this workout</button>`;
}

function renderSettings() {
  const count = doneSessions().length;
  app.innerHTML = `<div class="topbar"><button class="icon-btn" data-act="go" data-to="" aria-label="Home">⌂</button>
    <div class="title">Backup</div><span style="width:42px"></span></div>
    <div class="card">
      <h2>Your data</h2>
      <p class="small muted">${count} saved workout${count === 1 ? '' : 's'}, stored on this phone.
      Storage ${S.persisted ? 'is protected from automatic clearing ✓' : 'may be cleared by Chrome if space runs low — export a backup now and then.'}</p>
      <button class="btn primary full" data-act="export-json" style="margin-bottom:10px">Export backup (.json)</button>
      <button class="btn full" data-act="export-csv" style="margin-bottom:10px">Export for Sheets (.csv)</button>
      <button class="btn soft full" data-act="import">Restore from backup</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <p class="small muted" style="text-align:center">Restoring merges with what's here — nothing is deleted.</p>`;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);

function exportJSON() {
  const data = { app: 'gym-tracker', version: 1, exportedAt: new Date().toISOString(), sessions: S.sessions };
  download(`gym-tracker-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function exportCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'day', 'exercise', 'set_or_round', 'weight_kg', 'reps_or_secs', 'rir', 'level'].join(',')];
  for (const s of doneSessions().slice().reverse()) {
    const date = new Date(s.finishedAt).toISOString().slice(0, 10);
    const day = PROGRAM[s.dayId];
    for (const block of day.blocks) {
      for (const ex of block.exercises || []) {
        const e = s.sets?.[ex.id];
        if (!e) continue;
        const name = EXERCISES[e.exId]?.name || e.exId;
        e.rows.forEach((r, i) => r.done && rows.push([date, day.name, name, i + 1, r.weight ?? '', r.reps ?? '', r.rir ?? '', ''].map(q).join(',')));
      }
      const c = s.circuits?.[block.id];
      for (const st of (c && block.stations) || []) {
        const exId = s.swaps?.[st.id] && st.alt ? st.alt.id : st.id;
        const cur = EXERCISES[exId];
        const lvl = c.levels?.[exId];
        (c.reps?.[exId] || []).forEach((v, r) => v !== '' && v != null && rows.push(
          [date, day.name, cur.name, r + 1, '', v, '', lvl != null && cur.levels ? cur.levels[lvl] : ''].map(q).join(',')));
      }
    }
  }
  download(`gym-tracker-${today()}.csv`, rows.join('\n'), 'text/csv');
}

async function importJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.sessions;
    if (!Array.isArray(list)) throw new Error('bad file');
    const valid = list.filter(s => s && s.id && s.dayId && PROGRAM[s.dayId] && s.status === 'done');
    await db.putMany(valid);
    valid.forEach(upsertLocal);
    toast(`Restored ${valid.length} workout${valid.length === 1 ? '' : 's'}`);
    render();
  } catch {
    toast("That file isn't a gym-tracker backup");
  }
}

/* =========================================================
   Rest timer + interval timer
   ========================================================= */
function startRest(secs) {
  S.rest = { endsAt: Date.now() + secs * 1000, total: secs, alerted: false };
  updateRestBar();
}

function updateRestBar() {
  if (!S.rest || route() !== 'session') { restbar.hidden = true; return; }
  const left = (S.rest.endsAt - Date.now()) / 1000;
  if (left <= 0 && !S.rest.alerted) { S.rest.alerted = true; alertUser(2); }
  if (left < -45) { S.rest = null; restbar.hidden = true; return; }
  const over = left <= 0;
  restbar.hidden = false;
  restbar.classList.toggle('over', over);
  const pct = over ? 100 : 100 - (left / S.rest.total) * 100;
  const html = `<div class="fill" style="width:${pct}%"></div>
    <div class="label"><small>${over ? 'Rest done' : 'Rest'}</small><span class="time">${over ? 'Go!' : fmtClock(Math.ceil(left))}</span></div>
    <button data-rest="add">+30s</button><button data-rest="skip">${over ? 'Close' : 'Skip'}</button>`;
  if (restbar.innerHTML !== html) restbar.innerHTML = html;
}

restbar.addEventListener('click', e => {
  const b = e.target.closest('[data-rest]');
  if (!b || !S.rest) return;
  if (b.dataset.rest === 'add') {
    const base = Math.max(S.rest.endsAt, Date.now());
    S.rest.endsAt = base + 30000;
    S.rest.total = Math.max(S.rest.total, (S.rest.endsAt - Date.now()) / 1000);
    S.rest.alerted = false;
  } else {
    S.rest = null;
  }
  updateRestBar();
});

function buildPhases(block) {
  const phases = [{ type: 'ready', dur: 10, r: 0, s: 0 }];
  for (let r = 0; r < block.rounds; r++) {
    block.stations.forEach((_, s) => {
      phases.push({ type: 'work', dur: block.work, r, s });
      const lastOne = r === block.rounds - 1 && s === block.stations.length - 1;
      if (!lastOne) {
        const nextS = (s + 1) % block.stations.length;
        phases.push({ type: 'rest', dur: block.rest, r: nextS === 0 ? r + 1 : r, s: nextS });
      }
    });
  }
  phases.push({ type: 'done', dur: 0, r: block.rounds - 1, s: block.stations.length - 1 });
  return phases;
}

function currentIntervalBlock() {
  if (!S.active) return null;
  const step = stepsFor(S.active.dayId)[S.active.step];
  return step?.kind === 'interval' ? step.block : null;
}

function ivToggle() {
  const block = currentIntervalBlock();
  if (!block) return;
  if (!S.ival || S.ival.blockId !== block.id) {
    S.ival = { blockId: block.id, phases: buildPhases(block), idx: 0, remain: 10, paused: true };
  }
  const iv = S.ival;
  if (iv.phases[iv.idx].type === 'done') return;
  if (iv.paused) { iv.paused = false; iv.endsAt = Date.now() + iv.remain * 1000; }
  else { iv.paused = true; iv.remain = Math.max(0, (iv.endsAt - Date.now()) / 1000); }
  updateInterval();
}
function ivAdvance() {
  const iv = S.ival;
  iv.idx = Math.min(iv.idx + 1, iv.phases.length - 1);
  const p = iv.phases[iv.idx];
  iv.remain = p.dur;
  if (!iv.paused) iv.endsAt = Date.now() + p.dur * 1000;
  alertUser(p.type === 'work' ? 2 : 1);
}

function updateInterval() {
  const iv = S.ival;
  const block = currentIntervalBlock();
  if (iv && !iv.paused) {
    // Advance through any phases that have elapsed (also covers the screen being off briefly).
    while ((iv.endsAt - Date.now()) <= 0 && iv.phases[iv.idx].type !== 'done') ivAdvance();
  }
  const panel = document.getElementById('iv-panel');
  if (!panel || !block) return;
  const active = iv && iv.blockId === block.id ? iv : null;
  const p = active ? active.phases[active.idx] : { type: 'ready', r: 0, s: 0, dur: 10 };
  const left = active ? (active.paused ? active.remain : (active.endsAt - Date.now()) / 1000) : p.dur;
  const name = EXERCISES[exIdFor(block.stations[p.s])].name;
  const labels = { ready: 'Get ready', work: 'Work', rest: 'Rest — next up', done: 'Circuit done' };

  panel.classList.toggle('rest', p.type === 'rest' || p.type === 'ready');
  setText('iv-phase', active?.paused && active.idx > 0 && p.type !== 'done' ? 'Paused' : labels[p.type]);
  setText('iv-clock', p.type === 'done' ? '✓' : fmtClock(Math.ceil(left)));
  setText('iv-what', p.type === 'done' ? 'Log any missing reps below' : name);
  setText('iv-round', `Round ${p.r + 1} of ${block.rounds}`);
  setText('iv-toggle', !active || active.paused ? (active && active.idx > 0 ? 'Resume' : 'Start') : 'Pause');

  document.querySelectorAll('[data-station]').forEach(el =>
    el.classList.toggle('current', !!active && p.type !== 'done' && Number(el.dataset.station) === p.s));
  document.querySelectorAll('[data-cell]').forEach(el =>
    el.classList.toggle('cell-current', !!active && p.type === 'work' && el.dataset.cell === `${p.r}-${p.s}`));
}
function setText(id, txt) { const el = document.getElementById(id); if (el && el.textContent !== txt) el.textContent = txt; }

setInterval(() => {
  if (route() !== 'session' || !S.active) return;
  updateRestBar();
  updateInterval();
  setText('elapsed', fmtClock((Date.now() - S.active.startedAt) / 1000));
}, 250);

/* =========================================================
   Actions
   ========================================================= */
function currentBlock() { return stepsFor(S.active.dayId)[S.active.step].block; }

function setStep(n) {
  const steps = stepsFor(S.active.dayId);
  S.active.step = clamp(n, 0, steps.length - 1);
  saveActive();
  window.scrollTo(0, 0);
  renderSession();
}

async function startDay(dayId) {
  if (S.active) {
    if (S.active.dayId === dayId) return go('session');
    if (!confirm(`Discard your unfinished ${PROGRAM[S.active.dayId].name} workout?`)) return;
    await discardActive(false);
  }
  S.active = newSession(dayId);
  S.rest = null; S.ival = null;
  saveActive(true);
  go('session');
}

async function discardActive(ask = true) {
  if (!S.active) return;
  if (ask && !confirm('Discard this workout? Nothing from it will be saved.')) return;
  const id = S.active.id;
  S.sessions = S.sessions.filter(s => s.id !== id);
  clearTimeout(saveTimer);
  S.active = null; S.rest = null; S.ival = null;
  await db.remove(id);
  if (ask) { go(''); render(); }
}

async function saveWorkout() {
  const a = S.active;
  a.status = 'done';
  a.finishedAt = Date.now();
  upsertLocal(a);
  await db.put(a);
  clearTimeout(saveTimer);
  S.active = null; S.rest = null; S.ival = null;
  toast('Workout saved 💪');
  go('');
}

app.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const x = Number(b.dataset.x), i = Number(b.dataset.i);

  switch (act) {
    case 'go': return go(b.dataset.to);
    case 'start': return startDay(b.dataset.day);
    case 'resume': return go('session');
    case 'discard': return discardActive(true);
    case 'prev': return setStep(S.active.step - 1);
    case 'next': return setStep(S.active.step + 1);
    case 'save': return saveWorkout();
    case 'warm':
      S.active.warmup[i] = !S.active.warmup[i];
      break;
    case 'check':
      S.active.checks[b.dataset.id] = !S.active.checks[b.dataset.id];
      break;
    case 'w-': case 'w+': {
      const ex = currentBlock().exercises[x];
      const { e } = entryFor(ex);
      const step = EXERCISES[e.exId].step || 2.5;
      const cur = toNum(e.rows[i].weight) ?? 0;
      e.rows[i].weight = round2(Math.max(0, cur + (act === 'w+' ? step : -step)));
      const input = app.querySelector(`input[data-field="weight"][data-x="${x}"][data-i="${i}"]`);
      if (input) input.value = e.rows[i].weight;
      return saveActive();
    }
    case 'rir': {
      const { e } = entryFor(currentBlock().exercises[x]);
      const v = Number(b.dataset.v);
      e.rows[i].rir = e.rows[i].rir === v ? null : v;
      break;
    }
    case 'tick': {
      const block = currentBlock();
      const { e } = entryFor(block.exercises[x]);
      const row = e.rows[i];
      if (!row.done && !(toNum(row.reps) > 0)) {
        toast('Add your reps first');
        app.querySelector(`input[data-field="reps"][data-x="${x}"][data-i="${i}"]`)?.focus();
        return;
      }
      row.done = !row.done;
      if (row.done) {
        const partnerDone = block.type === 'superset' && x === 0 && entryFor(block.exercises[1]).e.rows[i]?.done;
        if (block.type === 'single' || x === 1 || partnerDone) startRest(block.rest);
      }
      break;
    }
    case 'swap': {
      const ex = currentBlock().exercises[x];
      const entry = S.active.sets[ex.id];
      if (entry?.rows.some(r => r.done) && !confirm('Swapping clears the sets you logged for this exercise. Swap anyway?')) return;
      S.active.swaps[ex.id] = !S.active.swaps[ex.id];
      delete S.active.sets[ex.id];
      break;
    }
    case 'swap-station': {
      const st = currentBlock().stations[x];
      S.active.swaps[st.id] = !S.active.swaps[st.id];
      break;
    }
    case 'add-set': {
      const ex = currentBlock().exercises[x];
      const { e, last } = entryFor(ex);
      e.count += 1;
      e.rows.push(blankRow(last, e.rows.length));
      break;
    }
    case 'remove-set': {
      const { e } = entryFor(currentBlock().exercises[x]);
      if (e.count <= 1) return;
      if (e.rows[e.rows.length - 1].done && !confirm('Remove a set you already logged?')) return;
      e.count -= 1;
      e.rows.pop();
      break;
    }
    case 'iv-toggle': return ivToggle();
    case 'iv-skip':
      if (S.ival && S.ival.blockId === currentIntervalBlock()?.id) { ivAdvance(); updateInterval(); }
      return;
    case 'iv-reset':
      S.ival = null; updateInterval();
      return;
    case 'export-json': return exportJSON();
    case 'export-csv': return exportCSV();
    case 'import': return document.getElementById('import-file').click();
    case 'delete-hist': {
      if (!confirm('Delete this workout from your history?')) return;
      const id = b.dataset.id;
      S.sessions = S.sessions.filter(s => s.id !== id);
      await db.remove(id);
      return go('history');
    }
    default: return;
  }
  saveActive();
  renderSession();
});

app.addEventListener('input', ev => {
  const t = ev.target;
  if (!S.active) return;
  if (t.dataset.field) {
    const { e } = entryFor(currentBlock().exercises[Number(t.dataset.x)]);
    e.rows[Number(t.dataset.i)][t.dataset.field] = toNum(t.value.replace(',', '.'));
    saveActive();
  } else if (t.dataset.circ) {
    const block = currentBlock();
    const c = circuitFor(block);
    const exId = exIdFor(block.stations[Number(t.dataset.x)]);
    c.reps[exId][Number(t.dataset.r)] = t.value.trim() === '' ? '' : (toNum(t.value) ?? '');
    saveActive();
  }
});

app.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'import-file' && t.files[0]) return importJSON(t.files[0]);
  if (t.dataset.level && S.active) {
    const block = currentBlock();
    const exId = exIdFor(block.stations[Number(t.dataset.x)]);
    circuitFor(block).levels[exId] = Number(t.value);
    saveActive();
  }
});

// Swipe left/right between exercises.
let touch = null;
app.addEventListener('touchstart', e => {
  if (e.target.closest('input, select, .stepper')) { touch = null; return; }
  touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
app.addEventListener('touchend', e => {
  if (!touch || route() !== 'session' || !S.active) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
    const steps = stepsFor(S.active.dayId);
    const next = S.active.step + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < steps.length) setStep(next);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveActive(true);
  else if (route() === 'session' && S.active) keepAwake(true);
});

/* =========================================================
   Boot
   ========================================================= */
(async function init() {
  try {
    S.sessions = await db.getAll();
  } catch {
    S.sessions = [];
    toast('Storage unavailable — data will not be saved');
  }
  S.active = S.sessions.find(s => s.status === 'active') || null;
  db.persist().then(p => { S.persisted = p; });
  if (route() === 'session' && !S.active) go('');
  render();
})();
