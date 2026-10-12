// Main-thread side of the topic model: queues requests to the worker and
// falls back to keyword matching while the model loads or if it can't.
import { keywordClassify } from './topics.js';

let worker;
let nextId = 1;
const pending = new Map();
const listeners = new Set();

export const modelState = { status: 'idle', progress: 0, error: null };

function emit() { listeners.forEach((fn) => fn({ ...modelState })); }
export function onModelState(fn) { listeners.add(fn); fn({ ...modelState }); }

const fileProgress = {};

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./classifier.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      fileProgress[data.file] = [data.loaded, data.total];
      const [l, t] = Object.values(fileProgress).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
      modelState.progress = t ? l / t : 0;
      emit();
      return;
    }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.type === 'error') p.reject(new Error(data.message)); else p.resolve(data);
  };
  worker.onerror = (e) => {
    modelState.status = 'failed';
    modelState.error = e.message || 'The model worker crashed.';
    emit();
    pending.forEach((p) => p.reject(new Error(modelState.error)));
    pending.clear();
  };
  return worker;
}

function call(msg) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ ...msg, id });
  });
}

export async function loadModel() {
  if (modelState.status === 'loading' || modelState.status === 'ready') return;
  modelState.status = 'loading';
  modelState.error = null;
  emit();
  try {
    await call({ type: 'load' });
    modelState.status = 'ready';
  } catch (err) {
    modelState.status = 'failed';
    modelState.error = err.message;
  }
  emit();
}

// Returns { scores, source } where source is 'model' or 'keywords'.
export async function classify(text, topics) {
  const plainTopics = topics.map(({ id, name, about }) => ({ id, name, about }));
  if (modelState.status === 'ready') {
    try {
      const { scores } = await call({ type: 'classify', text, topics: plainTopics });
      return { scores, source: 'model' };
    } catch (err) {
      console.warn('Model classification failed, using keywords', err);
    }
  }
  return { scores: keywordClassify(text, topics), source: 'keywords' };
}
