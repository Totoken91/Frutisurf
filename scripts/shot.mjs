import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/';
const OUT = process.env.SHOT_OUT ?? 'shots';
const WAIT = Number(process.env.SHOT_WAIT ?? 3500);
const W = Number(process.env.SHOT_W ?? 1080);
const H = Number(process.env.SHOT_H ?? 1920);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });

// Pilotage scripte : permet de capturer une pose precise (virage, saut).
const DRIVE = process.env.SHOT_DRIVE ?? '';
if (DRIVE) {
  for (const seg of DRIVE.split(';')) {
    const [key, ms] = seg.split(':');
    if (key === 'wait') { await page.waitForTimeout(Number(ms)); continue; }
    await page.keyboard.down(key);
    await page.waitForTimeout(Number(ms));
    await page.keyboard.up(key);
  }
}
await page.waitForTimeout(WAIT);

const shots = (process.env.SHOT_SEQ ?? '0').split(',').map(Number);
for (const t of shots) {
  if (t > 0) await page.waitForTimeout(t);
  const name = `${OUT}/${process.env.SHOT_NAME ?? 'frame'}${t ? `-${t}` : ''}.png`;
  await page.screenshot({ path: name });
  console.log('shot ->', name);
}

if (errors.length) {
  console.log('\n--- CONSOLE ERRORS ---');
  errors.slice(0, 12).forEach((e) => console.log(' ', e));
  process.exitCode = 1;
} else {
  console.log('no console errors');
}
await browser.close();
