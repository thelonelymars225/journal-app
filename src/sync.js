// Cloud sync with Supabase.
// The journal still lives on this device (db.js) so it opens instantly and
// works offline. Every change is also noted in an outbox and uploaded; changes
// made on other devices are pulled down and handed to the app.
// Sync is on only when the build has VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY; without them the app stays local-only.
// Tables and row-level security: supabase/schema.sql.

import { createClient } from '@supabase/supabase-js';
import * as db from './db.js';

// Accepts the project URL with or without a copied API path like /rest/v1/.
const PROJECT_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const enabled = !!(PROJECT_URL && KEY);
const supabase = enabled ? createClient(PROJECT_URL, KEY) : null;

// Settings that follow you between devices. Backup reminders stay per device.
const SHARED_SETTINGS = ['topics', 'threshold', 'autoload', 'suggest', 'dismissed'];
const K = { outbox: 'sync:outbox', cursor: 'sync:cursor', user: 'sync:user', lastSyncAt: 'sync:lastSyncAt' };
const PAGE = 500;
const EPOCH = '1970-01-01T00:00:00Z';
// Pull a little before the last cursor, in case a write committed late.
const OVERLAP_MS = 30000;

let user = null;
let handlers = {};
let signingOut = false;
// What still has to be uploaded: id/key -> change counter. A counter that moved
// during an upload means it changed again and must stay in the outbox.
let outbox = { entries: {}, settings: {} };
let status = { state: 'idle', pending: 0, lastSyncAt: 0, error: '' };

// ---------- auth ----------

export async function currentUser() {
  if (!enabled) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

// Signing out removes the journal from this device; it stays in your account.
// Returns false if you chose to keep unsent changes instead.
export async function signOut() {
  await syncNow();
  if (pendingCount() && !confirm(`${pendingCount()} change(s) haven't been uploaded yet (you may be offline). Sign out anyway and lose them?`)) return false;
  signingOut = true;
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch { /* offline; the local session is cleared below anyway */ }
  for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
  await db.local.entries.clear();
  for (const k of [...SHARED_SETTINGS, ...Object.values(K)]) await db.local.settings.set(k, undefined);
  return true;
}

export const userEmail = () => user?.email ?? '';

// ---------- status ----------

const pendingCount = () => Object.keys(outbox.entries).length + Object.keys(outbox.settings).length;

function setStatus(patch) {
  status = { ...status, ...patch, pending: pendingCount() };
  handlers.onStatus?.(status);
}
export const syncStatus = () => status;

// ---------- outbox ----------

const saveOutbox = () => db.local.settings.set(K.outbox, outbox);

function mark(kind, key) {
  const box = kind === 'entry' ? outbox.entries : outbox.settings;
  box[key] = (box[key] || 0) + 1;
}

function onLocalChange(kind, key) {
  if (!user) return;
  if (kind === 'setting' && !SHARED_SETTINGS.includes(key)) return;
  mark(kind, key);
  saveOutbox();
  setStatus({});
  schedule(1500);
}

// ---------- upload ----------

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += PAGE) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + PAGE), { onConflict });
    if (error) throw error;
  }
}

async function push() {
  const entrySnap = { ...outbox.entries };
  const settingSnap = { ...outbox.settings };
  const rows = [];
  for (const id of Object.keys(entrySnap)) {
    const e = await db.local.entries.get(id);
    rows.push(e ? { user_id: user.id, id, data: e, deleted: false } : { user_id: user.id, id, data: {}, deleted: true });
  }
  await upsert('entries', rows, 'user_id,id');
  const settingRows = [];
  for (const key of Object.keys(settingSnap)) {
    settingRows.push({ user_id: user.id, key, value: (await db.local.settings.get(key)) ?? null });
  }
  await upsert('settings', settingRows, 'user_id,key');
  for (const [id, n] of Object.entries(entrySnap)) if (outbox.entries[id] === n) delete outbox.entries[id];
  for (const [key, n] of Object.entries(settingSnap)) if (outbox.settings[key] === n) delete outbox.settings[key];
  await saveOutbox();
}

// ---------- download ----------

async function fetchSince(table, columns, since) {
  const rows = [];
  let after = since;
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).gt('synced_at', after).order('synced_at').limit(PAGE);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
    after = data[data.length - 1].synced_at;
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Applies changes from other devices to this one. Anything still waiting in
// the outbox is newer here, so it's left alone and will be uploaded.
async function pull() {
  const cursor = (await db.local.settings.get(K.cursor)) || EPOCH;
  const since = cursor === EPOCH ? EPOCH : new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString();
  const [entryRows, settingRows] = await Promise.all([
    fetchSince('entries', 'id,data,deleted,synced_at', since),
    fetchSince('settings', 'key,value,synced_at', since),
  ]);
  const changed = [];
  const removed = [];
  const remote = {}; // id -> updatedAt (or null if deleted), used by the first sync
  for (const r of entryRows) {
    remote[r.id] = r.deleted ? null : r.data.updatedAt;
    if (outbox.entries[r.id]) continue;
    const mine = await db.local.entries.get(r.id);
    if (r.deleted) {
      if (mine) { await db.local.entries.remove(r.id); removed.push(r.id); }
    } else if (!mine || ((r.data.updatedAt ?? 0) >= (mine.updatedAt ?? 0) && !same(mine, r.data))) {
      await db.local.entries.put(r.data);
      changed.push(r.data);
    }
  }
  const settingsChanged = [];
  for (const r of settingRows) {
    if (!SHARED_SETTINGS.includes(r.key) || outbox.settings[r.key] || r.value === null) continue;
    if (same(await db.local.settings.get(r.key), r.value)) continue;
    await db.local.settings.set(r.key, r.value);
    settingsChanged.push(r.key);
  }
  const newest = [...entryRows, ...settingRows].reduce((m, r) => (r.synced_at > m ? r.synced_at : m), cursor);
  await db.local.settings.set(K.cursor, newest);
  if (changed.length || removed.length || settingsChanged.length) {
    await handlers.onRemoteChange?.({ changed, removed, settings: settingsChanged });
  }
  return { remote, remoteSettings: new Set(settingRows.map((r) => r.key)) };
}

// The first time this device syncs for your account, everything already on it
// is uploaded (unless the copy in your account is newer), and topics from both
// sides are combined.
async function firstSync() {
  const localEntries = await db.local.entries.all();
  const localSettings = {};
  for (const k of SHARED_SETTINGS) localSettings[k] = await db.local.settings.get(k);
  await db.local.settings.set(K.cursor, EPOCH);
  const { remote, remoteSettings } = await pull();
  for (const e of localEntries) {
    if (!(e.id in remote) || (remote[e.id] !== null && (e.updatedAt ?? 0) > (remote[e.id] ?? 0))) mark('entry', e.id);
  }
  for (const k of SHARED_SETTINGS) {
    const mine = localSettings[k];
    if (mine === undefined) continue;
    if (!remoteSettings.has(k)) { mark('setting', k); continue; }
    if (k === 'topics' || k === 'dismissed') {
      const theirs = (await db.local.settings.get(k)) || [];
      const key = (x) => (k === 'topics' ? x.id : x);
      const merged = [...theirs, ...mine.filter((x) => !theirs.some((y) => key(y) === key(x)))];
      if (merged.length !== theirs.length) {
        await db.local.settings.set(k, merged);
        mark('setting', k);
        await handlers.onRemoteChange?.({ changed: [], removed: [], settings: [k] });
      }
    }
  }
  await saveOutbox();
  await db.local.settings.set(K.user, user.id);
}

// ---------- scheduling ----------

let running = null;
let again = false;
let timer;

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export function syncNow() {
  if (!user) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    setStatus({ state: 'syncing', error: '' });
    try {
      if ((await db.local.settings.get(K.user)) !== user.id) await firstSync();
      if (pendingCount()) await push();
      await pull();
      const lastSyncAt = Date.now();
      await db.local.settings.set(K.lastSyncAt, lastSyncAt);
      setStatus({ state: 'synced', lastSyncAt });
    } catch (err) {
      console.warn('Sync failed', err);
      setStatus({ state: navigator.onLine ? 'error' : 'offline', error: err.message || String(err) });
    } finally {
      running = null;
      if (again) { again = false; schedule(500); }
    }
  })();
  return running;
}

// Starts syncing for the signed-in user. onRemoteChange({ changed, removed, settings })
// is called after changes from other devices are saved on this one.
export async function start(signedIn, { onRemoteChange, onStatus } = {}) {
  user = signedIn;
  handlers = { onRemoteChange, onStatus };
  outbox = (await db.local.settings.get(K.outbox)) || { entries: {}, settings: {} };
  status.lastSyncAt = (await db.local.settings.get(K.lastSyncAt)) || 0;
  db.onLocalChange(onLocalChange);
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && !signingOut) location.reload(); });
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow();
}
