import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { validateBytes } from 'gltf-validator';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const directory = new URL('../public/models/vehicles/', import.meta.url);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of (await readdir(directory)).filter(f => f.endsWith('.glb'))) {
  const url = new URL(file, directory);
  const document = await io.readBinary(await readFile(url));
  await document.transform(weld(), dedup(), prune());
  const bytes = await io.writeBinary(document);
  const report = await validateBytes(bytes, { uri: file });
  if (report.issues.numErrors) throw new Error(`${file}: ${JSON.stringify(report.issues)}`);
  await writeFile(url, bytes);
  console.log(file, Math.round(bytes.length / 1024) + ' KiB', 'validation errors:', report.issues.numErrors);
}
const manifestUrl = new URL('manifest.json', directory);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
for (const entry of manifest) entry.bytes = (await readFile(new URL(entry.id + '.glb', directory))).length;
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
