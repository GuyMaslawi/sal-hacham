// Copies the on-phone text recognizer (Tesseract) and its Hebrew model from node_modules into
// public/ocr, so reading a photographed list needs no outside server. Runs before dev and build;
// the copies are not committed.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';

const OUT = 'public/ocr';
const FILES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // The worker picks the fastest engine the device supports; all three read the same way.
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/heb/4.0.0_best_int/heb.traineddata.gz', 'heb.traineddata.gz'],
];

mkdirSync(OUT, { recursive: true });
for (const [from, to] of FILES) {
  const target = `${OUT}/${to}`;
  if (existsSync(target) && statSync(target).size === statSync(from).size) continue;
  copyFileSync(from, target);
}
