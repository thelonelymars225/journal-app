// Downloads the topic model into public/models/ so it ships inside the app.
// Runs automatically after `npm install`; skips files that are already there.
// After this, the app never needs the internet to sort entries.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL = 'Xenova/mobilebert-uncased-mnli';
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models', MODEL);

// --require: fail instead of skipping (used when packaging so a release never ships without the model).
const REQUIRE = process.argv.includes('--require');

const exists = (p) => stat(p).then((s) => s.size > 0, () => false);

let total = 0;
for (const file of FILES) {
  const dest = join(outDir, file);
  if (await exists(dest)) { total += (await stat(dest)).size; continue; }
  const url = `https://huggingface.co/${MODEL}/resolve/main/${file}`;
  process.stdout.write(`Downloading ${file}… `);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    total += buf.length;
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  } catch (err) {
    console.log('failed');
    console.warn(`\nCouldn't download the topic model (${err.message}).\n` +
      'The app still works and sorts by keywords. Run `npm run fetch-model` later to add the model.');
    process.exit(REQUIRE ? 1 : 0); // never fail `npm install` over this
  }
}
console.log(`Topic model ready in public/models (${(total / 1e6).toFixed(1)} MB).`);
