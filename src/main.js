import * as db from './db.js';
import * as sync from './sync.js';
import { DEFAULT_TOPICS, PALETTE, SUGGESTION_POOL, pickTopics } from './topics.js';
import { classify, loadModel, onModelState, modelState } from './classifier.js';
import { generateTitle } from './titles.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const state = {
  entries: [],
  topics: [],
  threshold: 0.5,
  autoload: true,
  suggest: true,
  dismissed: [], // suggestion pool ids the user said no to
  suggestion: null, // { topic, entryIds }
  lastBackupAt: 0,
  backupSnoozeUntil: 0,
  protection: 'unknown', // see db.protectStorage()
  filter: 'all', // 'all' | 'unsorted' | topic id
  search: '',
  sort: 'updatedAt',
  currentId: null,
};

// ---------- formatting ----------

const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayAndTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// "Today, 8:55 PM" / "Yesterday, 9:10 AM" / "Tue, Oct 14, 7:02 PM"
function when(ts) {
  const day = (t) => new Date(t).toDateString();
  if (day(ts) === day(Date.now())) return `${rtf.format(0, 'day')}, ${timeOnly.format(ts)}`.replace(/^./, (c) => c.toUpperCase());
  if (day(ts) === day(Date.now() - 86400000)) return `${rtf.format(-1, 'day')}, ${timeOnly.format(ts)}`.replace(/^./, (c) => c.toUpperCase());
  return dayAndTime.format(ts);
}

function relative(ts) {
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return shortDate.format(ts);
}

const topicById = (id) => state.topics.find((t) => t.id === id);
// A title you typed always wins; otherwise one is made from the entry's opening words.
const entryTitle = (e) => e.title.trim() || generateTitle(e.body) || 'Untitled';

// ---------- sidebar ----------

function renderNav() {
  const counts = { all: state.entries.length, unsorted: 0 };
  for (const e of state.entries) {
    if (!e.topics.length) counts.unsorted++;
    for (const t of e.topics) counts[t] = (counts[t] || 0) + 1;
  }
  const item = (id, label, color) => `
    <button class="nav-item ${state.filter === id ? 'active' : ''}" data-filter="${esc(id)}">
      ${color ? `<span class="dot" style="background:${esc(color)}"></span>` : '<span class="dot hollow"></span>'}
      <span class="nav-label">${esc(label)}</span>
      <span class="count">${counts[id] || 0}</span>
    </button>`;
  $('#topic-nav').innerHTML =
    item('all', 'All entries') +
    '<div class="nav-heading">Life topics</div>' +
    state.topics.map((t) => item(t.id, t.name, t.color)).join('') +
    item('unsorted', 'Not sorted yet');
}

$('#topic-nav').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-filter]');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  renderNav();
  renderList();
  show('list');
});

// ---------- list ----------

function visibleEntries() {
  const q = state.search.trim().toLowerCase();
  return state.entries
    .filter((e) => state.filter === 'all' || (state.filter === 'unsorted' ? !e.topics.length : e.topics.includes(state.filter)))
    .filter((e) => !q || e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q))
    .sort((a, b) => b[state.sort] - a[state.sort]);
}

function chip(t, removable = false) {
  return `<span class="chip" style="--c:${esc(t.color)}">${esc(t.name)}${removable ? `<button class="chip-x" data-remove="${esc(t.id)}" aria-label="Remove ${esc(t.name)}">×</button>` : ''}</span>`;
}

function renderList() {
  const title = state.filter === 'all' ? 'All entries' : state.filter === 'unsorted' ? 'Not sorted yet' : topicById(state.filter)?.name || 'Entries';
  $('#list-title').textContent = title;
  const list = visibleEntries();
  if (!list.length) {
    $('#entry-list').innerHTML = `<div class="list-empty">${state.entries.length ? 'No entries here yet.' : 'Your journal is empty. Write your first entry.'}</div>`;
    return;
  }
  $('#entry-list').innerHTML = list.map((e) => {
    // Untitled entries show their text in full under the made-up title, unless it says nothing more.
    const body = e.body.trim();
    const snippet = (e.title.trim() || body.length > entryTitle(e).length + 12 ? body : '').slice(0, 140);
    const dateLabel = state.sort === 'createdAt' ? shortDate.format(e.createdAt) : `Edited ${relative(e.updatedAt)}`;
    return `
      <button class="entry-card ${e.id === state.currentId ? 'active' : ''}" data-id="${esc(e.id)}">
        <div class="entry-top"><span class="entry-title">${esc(entryTitle(e))}</span><span class="entry-date">${esc(dateLabel)}</span></div>
        ${snippet ? `<div class="entry-snippet">${esc(snippet)}</div>` : ''}
        <div class="chips">${e.topics.map(topicById).filter(Boolean).map((t) => chip(t)).join('')}${e.sorting ? '<span class="sorting">sorting…</span>' : ''}</div>
      </button>`;
  }).join('');
}

$('#entry-list').addEventListener('click', (ev) => {
  const card = ev.target.closest('[data-id]');
  if (card) openEntry(card.dataset.id);
});
$('#search').addEventListener('input', (ev) => { state.search = ev.target.value; renderList(); });
$('#sort').addEventListener('change', (ev) => { state.sort = ev.target.value; renderList(); });

// ---------- editor ----------

const current = () => state.entries.find((e) => e.id === state.currentId);

function renderMeta() {
  const e = current();
  if (!e) return;
  $('#meta').innerHTML = `<span title="Created ${esc(fullDate.format(e.createdAt))}">${esc(when(e.createdAt))}</span>` +
    (e.updatedAt - e.createdAt > 60000 ? `<span title="${esc(fullDate.format(e.updatedAt))}">Edited ${esc(relative(e.updatedAt))}</span>` : '');
}

function renderEntryTopics() {
  const e = current();
  if (!e) return;
  const empty = e.sorting ? 'Sorting…' : !e.topicsSource ? 'Topics are added as you write' : 'No topics yet';
  $('#entry-topics').innerHTML = e.topics.map(topicById).filter(Boolean).map((t) => chip(t, true)).join('') ||
    `<span class="muted small">${empty}</span>`;
  const free = state.topics.filter((t) => !e.topics.includes(t.id));
  $('#add-topic').innerHTML = '<option value="">+ Add topic</option>' + free.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const src = {
    model: 'Sorted automatically by the on-device model',
    keywords: modelState.status === 'failed' ? 'Sorted by keywords (the model could not load)' : 'Sorted by keywords for now; the model will refine this once it loads',
    manual: 'You chose these topics, so automatic sorting is paused for this entry',
  }[e.topicsSource];
  $('#entry-topics').title = src || '';
}

// While the title is blank, it previews the title that will be used.
function renderTitleHint() {
  const e = current();
  if (!e) return;
  const auto = generateTitle(e.body);
  $('#title').placeholder = auto || 'Title (optional)';
  $('#title').classList.toggle('auto', !!auto);
  // A blank page shows nothing but the page; topics and Delete appear once there's something to file.
  $('#editor').classList.toggle('blank', !e.title.trim() && !e.body.trim());
}

function openEntry(id) {
  const prev = current();
  if (prev && prev.id !== id) discardIfEmpty(prev);
  state.currentId = id;
  const e = current();
  $('#editor-empty').hidden = !!e;
  $('#editor').hidden = !e;
  if (!e) return;
  $('#title').value = e.title;
  $('#body').value = e.body;
  $('#save-state').textContent = '';
  renderMeta();
  renderTitleHint();
  renderEntryTopics();
  renderList();
  show('editor');
}

async function newEntry() {
  const now = Date.now();
  const e = { id: uid(), title: '', body: '', createdAt: now, updatedAt: now, topics: [], topicScores: {}, topicsSource: null, sortedText: '' };
  state.entries.push(e);
  if (state.filter !== 'all' && state.filter !== 'unsorted') state.filter = 'all';
  renderNav();
  unsaved.add(e.id);
  openEntry(e.id);
  // Focus inside the tap itself, so the iPhone keyboard comes straight up.
  $('#body').focus();
}

const stripTransient = ({ sorting, ...rest }) => rest;

// A new entry is only stored once something is written in it, and an entry
// left blank is dropped, so a tap on "+" never leaves an empty page behind.
const unsaved = new Set();

async function discardIfEmpty(e) {
  if (e.title.trim() || e.body.trim()) return;
  clearTimeout(saveTimers.get(e.id)); saveTimers.delete(e.id);
  clearTimeout(sortTimers.get(e.id)); sortTimers.delete(e.id);
  state.entries = state.entries.filter((x) => x.id !== e.id);
  if (!unsaved.delete(e.id)) await db.entries.remove(e.id);
  renderNav();
  renderList();
}

async function saveNow(e) {
  if (!saveTimers.has(e.id)) return;
  clearTimeout(saveTimers.get(e.id));
  saveTimers.delete(e.id);
  unsaved.delete(e.id);
  await db.entries.put(stripTransient(e));
}

// Done: save right away and put the page away.
async function closeEditor() {
  const e = current();
  if (!e) return;
  $('#body').blur(); $('#title').blur();
  await saveNow(e);
  openEntry(null);
  renderList();
  show('list');
  if (e.body.trim() && sortTimers.has(e.id)) { clearTimeout(sortTimers.get(e.id)); sortTimers.delete(e.id); sortEntry(e); }
}

// Timers are per entry so switching entries mid-typing never drops a save or a sort.
const saveTimers = new Map();
const sortTimers = new Map();

function onEdit() {
  const e = current();
  if (!e) return;
  e.title = $('#title').value;
  e.body = $('#body').value;
  e.updatedAt = Date.now();
  $('#save-state').textContent = 'Saving…';
  renderTitleHint();
  clearTimeout(saveTimers.get(e.id));
  saveTimers.set(e.id, setTimeout(async () => {
    saveTimers.delete(e.id);
    unsaved.delete(e.id);
    await db.entries.put(stripTransient(e));
    if (e.id === state.currentId) { $('#save-state').textContent = 'Saved'; renderMeta(); }
    renderList();
  }, 400));
  clearTimeout(sortTimers.get(e.id));
  sortTimers.set(e.id, setTimeout(() => { sortTimers.delete(e.id); sortEntry(e); }, 2000));
}

$('#title').addEventListener('input', onEdit);
$('#body').addEventListener('input', onEdit);
$('#new-entry').addEventListener('click', newEntry);
$('#quick-new').addEventListener('click', newEntry);
$('#editor-empty').addEventListener('click', newEntry);
$('#done').addEventListener('click', closeEditor);
$('#title').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); $('#body').focus(); }
});

// Keyboard: N starts an entry, Esc or Cmd/Ctrl+Enter finishes it.
document.addEventListener('keydown', (ev) => {
  if ($('#app').hidden || $('#settings').open) return;
  const typing = ev.target.closest?.('input, textarea, select');
  if (current() && (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)))) {
    ev.preventDefault();
    closeEditor();
  } else if (!typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && ev.key.toLowerCase() === 'n') {
    ev.preventDefault();
    newEntry();
  }
});

$('#delete-entry').addEventListener('click', async () => {
  const e = current();
  if (!e) return;
  if (!e.title.trim() && !e.body.trim()) { closeEditor(); return; }
  if (!confirm(`Delete “${entryTitle(e)}”? This can't be undone.`)) return;
  state.entries = state.entries.filter((x) => x.id !== e.id);
  clearTimeout(saveTimers.get(e.id)); saveTimers.delete(e.id);
  clearTimeout(sortTimers.get(e.id)); sortTimers.delete(e.id);
  if (!unsaved.delete(e.id)) await db.entries.remove(e.id);
  state.currentId = null;
  openEntry(null);
  renderNav();
  renderList();
  show('list');
});

$('#entry-topics').addEventListener('click', async (ev) => {
  const id = ev.target.closest('[data-remove]')?.dataset.remove;
  const e = current();
  if (!id || !e) return;
  e.topics = e.topics.filter((t) => t !== id);
  e.topicsSource = 'manual';
  await db.entries.put(stripTransient(e));
  renderEntryTopics(); renderNav(); renderList();
});

$('#add-topic').addEventListener('change', async (ev) => {
  const e = current();
  if (!ev.target.value || !e) return;
  e.topics.push(ev.target.value);
  e.topicsSource = 'manual';
  await db.entries.put(stripTransient(e));
  renderEntryTopics(); renderNav(); renderList();
});

$('#resort').addEventListener('click', () => {
  const e = current();
  if (e) sortEntry(e, { force: true });
});

// ---------- automatic sorting ----------

const textOf = (e) => `${e.title}\n\n${e.body}`.trim();

async function sortEntry(e, { force = false } = {}) {
  const text = textOf(e);
  if (!force && (e.topicsSource === 'manual' || text.length < 12)) return;
  // Skip if nothing changed since the last model pass.
  if (!force && e.sortedText === text && e.topicsSource === 'model') return;
  e.sorting = true;
  if (e.id === state.currentId) renderEntryTopics();
  renderList();
  try {
    const { scores, source } = await classify(text, state.topics);
    e.topicScores = scores;
    e.topics = pickTopics(scores, { threshold: source === 'model' ? state.threshold : 0.5 });
    e.topicsSource = source;
    e.sortedText = text;
    await db.entries.put(stripTransient(e));
  } finally {
    e.sorting = false;
  }
  if (e.id === state.currentId) renderEntryTopics();
  renderNav();
  renderList();
  scheduleSuggestionScan();
}

// When the model becomes ready, upgrade entries that were only keyword-sorted.
async function upgradeKeywordSorted() {
  for (const e of state.entries.filter((x) => x.topicsSource === 'keywords' || (!x.topicsSource && textOf(x).length >= 12))) {
    await sortEntry(e);
  }
}

onModelState((s) => {
  const el = $('#model-status');
  const label = {
    idle: 'Topic model not loaded',
    loading: `Loading topic model… ${Math.round(s.progress * 100)}%`,
    ready: 'Topic model ready (on-device)',
    failed: 'Topic model unavailable, using keywords',
  }[s.status];
  el.className = `model-status ${s.status}`;
  el.textContent = label;
  el.title = s.error || '';
  if (s.status === 'ready' && !upgraded) { upgraded = true; upgradeKeywordSorted().then(() => scheduleSuggestionScan(500)); }
  if (current()) renderEntryTopics();
});
let upgraded = false;

// ---------- topic suggestions ----------
// The model also scores entries against a pool of extra life topics. When at
// least 3 entries clearly fit one that isn't in your list, it's offered here.
// Nothing changes until you accept.

const SUGGEST_MIN_ENTRIES = 3;
let scanTimer;
let scanning = false;
let rescan = false;

function scheduleSuggestionScan(delay = 4000) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanSuggestions, delay);
}

function poolCandidates() {
  const have = new Set(state.topics.map((t) => t.name.trim().toLowerCase()));
  return SUGGESTION_POOL.filter((t) => !state.dismissed.includes(t.id) && !have.has(t.name.toLowerCase()));
}

async function scanSuggestions() {
  if (scanning) { rescan = true; return; }
  if (!state.suggest) { state.suggestion = null; renderSuggestion(); return; }
  scanning = true;
  try {
    const recent = [...state.entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
    for (const e of recent) {
      const text = textOf(e);
      if (text.length < 40) continue;
      const stale = e.poolText !== text || (e.poolSource === 'keywords' && modelState.status === 'ready');
      if (!stale) continue;
      const { scores, source } = await classify(text, SUGGESTION_POOL);
      Object.assign(e, { poolScores: scores, poolText: text, poolSource: source });
      await db.entries.put(stripTransient(e));
    }
    let best = null;
    for (const t of poolCandidates()) {
      const ids = state.entries
        .filter((e) => (e.poolScores?.[t.id] ?? 0) >= (e.poolSource === 'model' ? 0.75 : 0.66))
        .map((e) => e.id);
      if (ids.length >= SUGGEST_MIN_ENTRIES && (!best || ids.length > best.entryIds.length)) best = { topic: t, entryIds: ids };
    }
    state.suggestion = best;
    renderSuggestion();
  } finally {
    scanning = false;
    if (rescan) { rescan = false; scheduleSuggestionScan(500); }
  }
}

function renderSuggestion() {
  const el = $('#suggestion');
  const s = state.suggestion;
  el.hidden = !s;
  if (!s) return;
  el.innerHTML = `
    <div class="suggest-label">Suggested topic</div>
    <div class="suggest-name">${esc(s.topic.name)}</div>
    <div class="muted small">${s.entryIds.length} of your entries are about ${esc(s.topic.about)}.</div>
    <div class="suggest-actions">
      <button class="primary small" data-suggest="accept">Add topic</button>
      <button class="ghost small" data-suggest="dismiss">Not now</button>
    </div>`;
}

$('#suggestion').addEventListener('click', async (ev) => {
  const action = ev.target.closest('[data-suggest]')?.dataset.suggest;
  const s = state.suggestion;
  if (!action || !s) return;
  state.suggestion = null;
  renderSuggestion();
  if (action === 'dismiss') {
    state.dismissed.push(s.topic.id);
    await saveSettings();
    scheduleSuggestionScan(500);
    return;
  }
  const { name, about, keywords } = s.topic;
  state.topics.push({ id: uid(), name, about, keywords, color: PALETTE[state.topics.length % PALETTE.length] });
  await saveSettings();
  renderNav();
  // File the matching entries under the new topic (leaving hand-picked ones alone).
  for (const e of state.entries.filter((x) => s.entryIds.includes(x.id) && x.topicsSource !== 'manual')) {
    await sortEntry(e, { force: true });
  }
  scheduleSuggestionScan(500);
});

// ---------- settings ----------

async function saveSettings() {
  await db.settings.set('topics', state.topics);
  await db.settings.set('threshold', state.threshold);
  await db.settings.set('autoload', state.autoload);
  await db.settings.set('suggest', state.suggest);
  await db.settings.set('dismissed', state.dismissed);
}

function renderTopicEditor() {
  $('#topic-editor').innerHTML = state.topics.map((t) => `
    <div class="topic-edit" data-id="${esc(t.id)}">
      <input type="color" value="${esc(t.color)}" data-field="color" aria-label="Color" />
      <input value="${esc(t.name)}" data-field="name" placeholder="Name" class="t-name" />
      <input value="${esc(t.about)}" data-field="about" placeholder="What belongs here, in a few words" class="t-about" />
      <button type="button" class="ghost danger small" data-delete aria-label="Delete topic">✕</button>
    </div>`).join('');
}

$('#topic-editor').addEventListener('input', async (ev) => {
  const row = ev.target.closest('[data-id]');
  const t = topicById(row?.dataset.id);
  if (!t) return;
  t[ev.target.dataset.field] = ev.target.value;
  await saveSettings();
  renderNav();
  renderList();
});

$('#topic-editor').addEventListener('click', async (ev) => {
  if (!ev.target.closest('[data-delete]')) return;
  const id = ev.target.closest('[data-id]').dataset.id;
  const t = topicById(id);
  if (!confirm(`Remove the topic “${t.name}”? Entries keep their text; they just won't be filed under it.`)) return;
  state.topics = state.topics.filter((x) => x.id !== id);
  for (const e of state.entries.filter((x) => x.topics.includes(id))) {
    e.topics = e.topics.filter((x) => x !== id);
    await db.entries.put(stripTransient(e));
  }
  if (state.filter === id) state.filter = 'all';
  await saveSettings();
  scheduleSuggestionScan(500);
  renderTopicEditor(); renderNav(); renderList(); renderEntryTopics();
});

$('#add-topic-row').addEventListener('click', async () => {
  state.topics.push({ id: uid(), name: 'New topic', about: '', color: PALETTE[state.topics.length % PALETTE.length] });
  await saveSettings();
  renderTopicEditor(); renderNav();
  $('#topic-editor .topic-edit:last-child .t-name').select();
});

$('#threshold').addEventListener('input', async (ev) => {
  state.threshold = Number(ev.target.value);
  $('#threshold-value').textContent = `${Math.round(state.threshold * 100)}%`;
  await saveSettings();
});
$('#autoload').addEventListener('change', async (ev) => { state.autoload = ev.target.checked; await saveSettings(); });
$('#suggest').addEventListener('change', async (ev) => {
  state.suggest = ev.target.checked;
  if (ev.target.checked) state.dismissed = [];
  await saveSettings();
  scheduleSuggestionScan(100);
});
$('#load-model').addEventListener('click', loadModel);

$('#resort-all').addEventListener('click', async () => {
  const targets = state.entries.filter((e) => e.topicsSource !== 'manual');
  const out = $('#resort-progress');
  for (let i = 0; i < targets.length; i++) {
    out.textContent = `Re-sorting ${i + 1} of ${targets.length}…`;
    await sortEntry(targets[i], { force: true });
  }
  out.textContent = targets.length ? `Re-sorted ${targets.length} entries${modelState.status === 'ready' ? '' : ' using keywords (model not loaded)'}.` : 'Nothing to re-sort.';
});

$('#reveal-data').addEventListener('click', () => db.revealData());

// ---------- backups ----------
// A backup is one JSON file. On iPhone it opens the share sheet, so you can
// "Save to Files" (iCloud Drive or On My iPhone); elsewhere it downloads.

const BACKUP_EVERY_DAYS = 7;
const DAY = 86400000;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

async function backup() {
  const data = { app: 'journal', version: 1, exportedAt: new Date().toISOString(), topics: state.topics, entries: state.entries.map(stripTransient) };
  const name = `journal-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Journal backup' });
    } catch (err) {
      if (err.name === 'AbortError') return false; // closed the share sheet
      throw err;
    }
  } else {
    const url = URL.createObjectURL(file);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  state.lastBackupAt = Date.now();
  await db.settings.set('lastBackupAt', state.lastBackupAt);
  renderBackupReminder();
  renderDataStatus();
  return true;
}

function backupDue() {
  if (sync.enabled || !state.entries.length) return false;
  const lastChange = Math.max(...state.entries.map((e) => e.updatedAt));
  if (lastChange <= state.lastBackupAt) return false; // nothing new since the last backup
  const since = state.lastBackupAt || Math.min(...state.entries.map((e) => e.createdAt));
  return Date.now() - since > BACKUP_EVERY_DAYS * DAY && Date.now() > state.backupSnoozeUntil;
}

function renderBackupReminder() {
  const el = $('#backup-reminder');
  el.hidden = !backupDue();
  if (el.hidden) return;
  const when = state.lastBackupAt ? `Your last backup was ${relative(state.lastBackupAt)}.` : "You haven't saved a backup yet.";
  el.innerHTML = `
    <div class="suggest-label">Backup</div>
    <div class="suggest-name">Save a copy of your journal</div>
    <div class="muted small">${esc(when)} Your entries only live on this device${isIOS ? '; save a copy to Files or iCloud Drive' : ''}.</div>
    <div class="suggest-actions">
      <button class="primary small" data-backup="now">Back up</button>
      <button class="ghost small" data-backup="later">Later</button>
    </div>`;
}

$('#backup-reminder').addEventListener('click', async (ev) => {
  const action = ev.target.closest('[data-backup]')?.dataset.backup;
  if (action === 'now') await backup().catch((err) => alert(`Couldn't save the backup: ${err.message}`));
  if (action === 'later') {
    state.backupSnoozeUntil = Date.now() + 3 * DAY;
    await db.settings.set('backupSnoozeUntil', state.backupSnoozeUntil);
    renderBackupReminder();
  }
});

function renderDataStatus() {
  const status = $('#storage-status');
  const p = sync.enabled ? 'cloud' : state.protection;
  status.className = `storage-status ${p}`;
  status.textContent = {
    file: '',
    protected: 'Protected: this browser has agreed not to clear your journal to free up space.',
    unprotected: isIOS && !isInstalled()
      ? 'Not protected: Safari can clear website data you haven\'t used for a while. Add Journal to your Home Screen (Share → Add to Home Screen) and use it from there.'
      : 'Not protected yet: the browser may clear your journal if the device runs low on space. Keep regular backups.',
    unknown: 'This browser doesn\'t say whether it will keep your journal. Keep regular backups.',
    cloud: syncLabel(sync.syncStatus(), true),
  }[p] || '';
  status.hidden = p === 'file';
  $('#backup-status').textContent = state.lastBackupAt ? `Last backup: ${fullDate.format(state.lastBackupAt)}.` : 'No backup saved yet.';
}

$('#export').addEventListener('click', () => backup().catch((err) => alert(`Couldn't save the backup: ${err.message}`)));

$('#import').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error('No entries in this file.');
    const existing = new Set(state.entries.map((e) => e.id));
    let added = 0;
    for (const e of data.entries) {
      if (existing.has(e.id)) continue;
      const entry = { topics: [], topicScores: {}, title: '', body: '', ...e };
      state.entries.push(entry);
      await db.entries.put(entry);
      added++;
    }
    if (Array.isArray(data.topics)) {
      for (const t of data.topics) if (!topicById(t.id)) state.topics.push(t);
      await saveSettings();
    }
    renderTopicEditor(); renderNav(); renderList();
    alert(`Imported ${added} entries.`);
  } catch (err) {
    alert(`Couldn't import that file: ${err.message}`);
  }
  ev.target.value = '';
});

$('#open-settings').addEventListener('click', () => {
  renderTopicEditor();
  $('#threshold').value = state.threshold;
  $('#threshold-value').textContent = `${Math.round(state.threshold * 100)}%`;
  $('#autoload').checked = state.autoload;
  $('#suggest').checked = state.suggest;
  $('#resort-progress').textContent = '';
  renderDataStatus();
  if (sync.enabled) {
    $('#data-where').textContent = 'Your journal is saved to your Supabase account, and a copy stays on this device so it opens instantly and works offline. Topic sorting still runs on this device.';
    $('#account').hidden = false;
    $('#account-email').textContent = `Signed in as ${sync.userEmail()}`;
  } else if (db.storageKind === 'file') {
    db.dataLocation().then((where) => {
      $('#data-where').textContent = `Your journal is saved as a file on this computer: ${where}. It's kept when you quit, restart, or update the app. Export a backup now and then.`;
    });
    $('#reveal-data').hidden = false;
  }
  $('#settings').showModal();
});

// ---------- cloud sync ----------

function syncLabel(s, long = false) {
  const waiting = s.pending ? ` · ${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : '';
  if (s.state === 'syncing') return 'Syncing…';
  if (s.state === 'offline') return `Offline${waiting || ' · saved on this device'}`;
  if (s.state === 'error') return `Sync problem${long ? `: ${s.error}` : ''}${waiting}`;
  if (s.lastSyncAt) return `Synced ${relative(s.lastSyncAt)}${waiting}`;
  return `Not synced yet${waiting}`;
}

function renderSyncStatus(s = sync.syncStatus()) {
  const el = $('#sync-status');
  el.hidden = false;
  el.className = `model-status ${s.state === 'idle' ? '' : s.state}`;
  el.textContent = syncLabel(s);
  el.title = s.error || '';
  if ($('#settings').open) renderDataStatus();
}

// Changes from your other devices, already saved on this one.
async function applyRemote({ changed, removed, settings }) {
  for (const r of changed) {
    if (saveTimers.has(r.id)) continue; // you're typing in it here; your version wins
    const mine = state.entries.find((e) => e.id === r.id);
    if (mine) Object.assign(mine, r); else state.entries.push(r);
    if (r.id === state.currentId) {
      if ($('#title').value !== r.title) $('#title').value = r.title;
      if ($('#body').value !== r.body) $('#body').value = r.body;
      renderMeta();
      renderTitleHint();
      renderEntryTopics();
    }
  }
  if (removed.length) {
    state.entries = state.entries.filter((e) => !removed.includes(e.id));
    if (removed.includes(state.currentId)) { state.currentId = null; openEntry(null); show('list'); }
  }
  if (settings.length) {
    await loadSettings();
    if (state.filter !== 'all' && state.filter !== 'unsorted' && !topicById(state.filter)) state.filter = 'all';
    if ($('#settings').open) renderTopicEditor();
    if (current()) renderEntryTopics();
  }
  renderNav();
  renderList();
  scheduleSuggestionScan();
}

$('#sync-now').addEventListener('click', () => sync.syncNow());
$('#sign-out').addEventListener('click', async () => {
  if (await sync.signOut()) location.reload();
});

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#login-submit');
  btn.disabled = true;
  $('#login-error').textContent = '';
  try {
    const user = await sync.signIn($('#login-email').value.trim(), $('#login-password').value);
    $('#login').hidden = true;
    $('#login-password').value = '';
    await start(user);
  } catch (err) {
    $('#login-error').textContent = navigator.onLine
      ? (/invalid login/i.test(err.message) ? 'Wrong email or password.' : err.message)
      : "You're offline. Connect to the internet to sign in.";
  } finally {
    btn.disabled = false;
  }
});

// ---------- small screens: one pane at a time ----------

function show(pane) {
  $('#app').className = `app show-${pane}`;
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-show]');
  if (b) show(b.dataset.show);
});

// Keep "edited 3 minutes ago" fresh.
setInterval(() => { renderMeta(); renderList(); renderBackupReminder(); if (sync.enabled && !$('#app').hidden) renderSyncStatus(); }, 60000);

// ---------- start ----------

async function loadSettings() {
  state.topics = (await db.settings.get('topics')) || structuredClone(DEFAULT_TOPICS);
  state.threshold = (await db.settings.get('threshold')) ?? 0.5;
  state.autoload = (await db.settings.get('autoload')) ?? true;
  state.suggest = (await db.settings.get('suggest')) ?? true;
  state.dismissed = (await db.settings.get('dismissed')) || [];
}

// With cloud sync on, the journal opens only after you sign in (once per device).
async function init() {
  if (sync.enabled) {
    const user = await sync.currentUser();
    if (!user) {
      $('#login').hidden = false;
      $('#login-email').focus();
      return;
    }
    await start(user);
  } else {
    await start(null);
  }
}

async function start(user) {
  $('#app').hidden = false;
  await loadSettings();
  state.lastBackupAt = (await db.settings.get('lastBackupAt')) || 0;
  state.backupSnoozeUntil = (await db.settings.get('backupSnoozeUntil')) || 0;
  state.entries = await db.entries.all();
  renderNav();
  renderList();
  if (state.autoload) loadModel();
  scheduleSuggestionScan(1500);
  renderBackupReminder();
  if (user) {
    renderSyncStatus();
    await sync.start(user, { onRemoteChange: applyRemote, onStatus: renderSyncStatus });
  }
  state.protection = await db.protectStorage();
}

init();

// Installed web app: cache everything for offline use. Not used inside the Mac app.
if ('serviceWorker' in navigator && !window.journalFile && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable', err));
}
