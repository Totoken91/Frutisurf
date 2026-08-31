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
// Format: "wait:800;down:ShiftLeft;wait:4000;down:ArrowRight;wait:1500;up:ArrowRight"
// down/up permettent de MAINTENIR plusieurs touches en meme temps (boost + virage).
const DRIVE = process.env.SHOT_DRIVE ?? '';
if (DRIVE) {
  for (const seg of DRIVE.split(';')) {
    const [op, arg] = seg.split(':');
    if (op === 'wait') await page.waitForTimeout(Number(arg));
    else if (op === 'down') await page.keyboard.down(arg);
    else if (op === 'up') await page.keyboard.up(arg);
    else { await page.keyboard.down(op); await page.waitForTimeout(Number(arg)); await page.keyboard.up(op); }
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

// Les erreurs de compilation GLSL passent par la console et ne cassent RIEN
// de visible cote script : le maillage disparait, c'est tout. Elles sont donc
// remontees en PREMIER et en clair, sinon une capture "reussie" peut masquer
// un sol qui ne se dessine plus.
const glsl = errors.filter((e) => /ERROR: \d+:\d+|shader|GLSL/i.test(e));
if (glsl.length) {
  console.log('\n!!! SHADER CASSE !!!');
  glsl.slice(0, 10).forEach((e) => e.split('\n').slice(0, 4).forEach((l) => console.log('  ', l)));
}
if (errors.length) {
  console.log(`\n--- ${errors.length} erreur(s) console ---`);
  errors.slice(0, 8).forEach((e) => console.log(' ', e.slice(0, 220)));
  process.exitCode = 1;
} else {
  console.log('no console errors');
}
await browser.close();
