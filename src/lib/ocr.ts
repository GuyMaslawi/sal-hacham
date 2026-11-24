// Reading a list from a photo or a screenshot, entirely on the phone: the picture never leaves it.
// The recognizer (Tesseract, ~4 MB) and its Hebrew model are copied into public/ocr by
// scripts/copy-ocr.mjs and downloaded only the first time someone photographs a list.

import { cleanRecognizedText } from './text';

/** Large photos are shrunk first: it is much faster and reads just as well. */
const MAX_SIDE = 2000;

export interface ReadProgress {
  /** 0–1. */
  share: number;
  stage: 'loading' | 'reading';
}

const ocrBase = () => new URL('ocr/', document.baseURI).href;

/** Draw the picture upright (phones store photos sideways plus a rotation flag) and not too large. */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** The text of a shopping list in a picture, one item per line ('' when nothing readable). */
export async function readListFromImage(file: Blob, onProgress: (p: ReadProgress) => void): Promise<string> {
  onProgress({ share: 0, stage: 'loading' });
  const [{ createWorker, OEM, PSM }, canvas] = await Promise.all([import('tesseract.js'), prepare(file)]);
  const base = ocrBase();
  const worker = await createWorker('heb', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    // The worker script is served from this site, so it can be started directly.
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress({ share: m.progress, stage: 'reading' });
      else if (m.status.startsWith('loading')) onProgress({ share: m.progress * 0.99, stage: 'loading' });
    },
  });
  try {
    // Not `preserve_interword_spaces`: with Hebrew it glues the words of a line together.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const { data } = await worker.recognize(canvas);
    return cleanRecognizedText(data.text);
  } finally {
    void worker.terminate();
  }
}
