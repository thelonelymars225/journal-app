// Runs the topic model off the main thread so typing never stutters.
// The model and the ONNX runtime both ship inside the app (public/models and
// the bundled .wasm), so sorting works offline and journal text never leaves
// this machine. Nothing is fetched from the internet.
import { pipeline, env } from '@huggingface/transformers';
import ortWasm from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import ortMjs from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';

export const MODEL = 'Xenova/mobilebert-uncased-mnli';

env.allowRemoteModels = false;
env.allowLocalModels = true;
// public/models is served next to the app; this resolves both in dev and in the build.
env.localModelPath = new URL('../models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL(ortWasm, import.meta.url).href,
  mjs: new URL(ortMjs, import.meta.url).href,
};

let classifierPromise;

function load() {
  if (!classifierPromise) {
    classifierPromise = pipeline('zero-shot-classification', MODEL, {
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress') {
          self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        }
      },
    }).catch((err) => {
      classifierPromise = null;
      throw new Error(`The topic model isn't bundled yet (run \`npm run fetch-model\`). ${err?.message || err}`);
    });
  }
  return classifierPromise;
}

// Long entries are scored in chunks; a topic counts if any part of the entry is about it.
function chunk(text, size = 600, maxChunks = 6) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n' + p).length > size && cur) { chunks.push(cur); cur = p; } else { cur = cur ? `${cur}\n${p}` : p; }
  }
  if (cur) chunks.push(cur);
  return chunks.flatMap((c) => (c.length > size * 1.5 ? c.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) : [c])).slice(0, maxChunks);
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      await load();
      self.postMessage({ id, type: 'ready' });
      return;
    }
    if (type === 'classify') {
      const classifier = await load();
      const { text, topics } = data;
      const labels = topics.map((t) => t.about || t.name);
      const scores = Object.fromEntries(topics.map((t) => [t.id, 0]));
      for (const part of chunk(text)) {
        const out = await classifier(part, labels, {
          multi_label: true,
          hypothesis_template: 'This journal entry is about {}.',
        });
        out.labels.forEach((label, i) => {
          const topic = topics[labels.indexOf(label)];
          scores[topic.id] = Math.max(scores[topic.id], out.scores[i]);
        });
      }
      self.postMessage({ id, type: 'result', scores });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
};
