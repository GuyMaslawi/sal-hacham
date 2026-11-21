// Renders the Google Play listing pictures: phone screenshots of the live site (taken by walking
// through it the way a shopper would) and the feature graphic. Needs Google Chrome installed.
//
//   node scripts/store-assets.mjs            → store/screenshots/*.png, store/feature-graphic.png
//
// Play wants phone screenshots no longer than twice their width; 1242×2208 (9:16) is safe.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = 'https://guymaslawi.github.io/sal-hacham/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const CITY = 'חיפה';
const LIST = ['חלב 3% 2', "קוטג'", 'לחם אחיד', 'ביצים', 'אורז', 'פסטה', 'שמן קנולה', 'קפה נמס', 'נייר טואלט', 'במבה', 'שוקולד פרה', 'טחינה'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'sal-store-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--lang=he-IL', '--hide-scrollbars', '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);

let ws;
try {
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      await sleep(200);
    }
  }
  if (!ws) throw new Error('Chrome did not start');
  await new Promise((r) => (ws.onopen = r));

  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const run = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async (expression, what, timeout = 30000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(250)) if (await run(expression)) return;
    throw new Error(`Timed out waiting for ${what}`);
  };
  /** Click the first button or link whose text starts with `text`. */
  const click = async (text) => {
    const ok = await run(`(() => {
      const el = [...document.querySelectorAll('button, a')].find((e) => e.innerText.trim().startsWith(${JSON.stringify(text)}));
      if (el) el.click();
      return !!el;
    })()`);
    if (!ok) throw new Error(`No button "${text}"`);
    await sleep(700);
  };
  /** Switch tabs through the bottom bar (a tab may carry a count badge before its name). */
  const tab = async (name) => {
    const ok = await run(`(() => {
      const el = [...document.querySelectorAll('nav[aria-label="ניווט ראשי"] button')].find((b) => b.innerText.includes(${JSON.stringify(name)}));
      if (el) el.click();
      return !!el;
    })()`);
    if (!ok) throw new Error(`No tab "${name}"`);
    await sleep(700);
  };
  const hasText = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
  // Neither a passing notice nor the "downloading prices" bar.
  const settled = `![...document.querySelectorAll('[aria-live=polite].fixed, [role=status], [role=alert]')].some((e) => e.innerText.trim())`;

  const shots = resolve('store/screenshots');
  mkdirSync(shots, { recursive: true });
  const shoot = async (name) => {
    await sleep(900);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`  ${name}.png`);
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  console.log('Screenshots:');
  await send('Page.navigate', { url: SITE });
  await waitFor(hasText('בחר עיר'), 'the welcome screen');
  await shoot('6-welcome');

  await click('בחר עיר');
  await waitFor(hasText(CITY), 'the city list');
  await click(CITY);
  await waitFor(hasText('המשך עם'), 'the suggested stores');
  await shoot('5-nearby');
  await click('המשך עם');
  await waitFor(hasText('הדבק רשימה'), 'the empty list');

  await click('הדבק רשימה');
  await run(`(() => {
    const box = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(LIST.join('\n'))});
    box.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(`הוסף ${LIST.length} שורות`);
  // Confirm the product the app suggests for every pasted line.
  for (let i = 0; i < 40; i++) {
    const left = await run(`(() => {
      const yes = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'כן, זה המוצר');
      yes[0]?.click();
      return yes.length;
    })()`);
    if (!left) break;
    await sleep(150);
  }
  await waitFor(hasText('הבא: איפה הכי זול?'), 'prices on the list');
  await waitFor(settled, 'the notices to close', 20000);
  await shoot('1-list');

  await click('הבא: איפה הכי זול?');
  await waitFor(hasText('הכי זול'), 'the comparison');
  await shoot('2-compare');

  await tab('בסופר');
  await sleep(500);
  await shoot('4-shop');

  await tab('רשימה');
  await run(`document.querySelector('section[aria-label="המוצרים ברשימה"] li button')?.click()`);
  await sleep(700);
  await shoot('3-product');

  console.log('Feature graphic:');
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(resolve('store/feature-graphic.html')).href });
  await waitFor(`document.fonts.status === 'loaded' && document.fonts.size > 0`, 'the fonts');
  await sleep(500);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve('store/feature-graphic.png'), Buffer.from(data, 'base64'));
  console.log('  feature-graphic.png');
} finally {
  ws?.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
