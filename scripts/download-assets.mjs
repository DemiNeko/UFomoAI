import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../dist/', import.meta.url);
const modelBase = 'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.50_224/';
await mkdir(new URL('vendor/', root), { recursive: true });
await mkdir(new URL('model/', root), { recursive: true });
const hashes = {};
async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(path, root), bytes);
  hashes[path] = createHash('sha256').update(bytes).digest('hex');
  return bytes;
}
await download('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js', 'vendor/tf.min.js');
await download('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/README.md', 'vendor/tensorflow-README.md');
await download('https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE', 'vendor/LICENSE-APACHE-2.0.txt');
const model = JSON.parse(await download(`${modelBase}model.json`, 'model/model.json'));
const paths = [...new Set(model.weightsManifest.flatMap(group => group.paths))];
// Small batches avoid flooding a connection with all weight files at once.
for (let i = 0; i < paths.length; i += 6) {
  await Promise.all(paths.slice(i, i + 6).map(path => download(`${modelBase}${path}`, `model/${path}`)));
}
await writeFile(new URL('asset-hashes.json', root), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Downloaded TensorFlow.js and MobileNet (${paths.length} weight files).`);
