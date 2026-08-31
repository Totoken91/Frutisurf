/**
 * Capture le cycle a heures fixes.
 *
 * Un cycle jour/nuit ne se juge pas sur une capture : ce qui compte est la
 * COHERENCE entre les couches a chaque instant. La faute typique — le ciel
 * bascule au crepuscule pendant que l'herbe reste en plein midi — n'apparait
 * que si l'on regarde plusieurs heures cote a cote.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedLoadout } from './lib/boot.mjs';

const OUT = 'shots/day';
mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W ?? 780);
const H = Number(process.env.H ?? 1200);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && /ERROR:/.test(m.text())) errs.push(m.text()); });
await seedLoadout(page);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// On avance jusqu'a un point qui montre TOUT : de l'eau, une greve, la ville.
await page.evaluate(() => {
  const g = window.__game;
  const c = g.controller;
  const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
  // On s'arrete AVANT la rive, pas dedans : place dans le lac, la camera se
  // retrouve au ras de l'eau et le cadrage ne montre plus ni greve ni herbe.
  for (let i = 0; i < 40000 && !c.onWater; i++) { c.z -= 0.4; c.speed = 34; c.step(1 / 120, pad); }
  c.z += 34;
  c.step(1/120, pad); c.y = c.groundY;
  g.run.timeLeft = 9999;
  const f = { x: c.x, y: c.y, z: c.z, speed: c.speed };
  c.step = () => { c.x = f.x; c.y = f.y; c.z = f.z; c.speed = f.speed; };
  g.rig.snap(c);
  g.rig.update = () => {};
});

const HOURS = [
  ['0-aube', 0.0],
  ['1-matin', 0.13],
  ['2-midi', 0.25],
  ['3-apres-midi', 0.38],
  ['4-couchant', 0.5],
  ['5-crepuscule', 0.57],
  ['6-nuit', 0.75],
];

for (const [name, phase] of HOURS) {
  await page.evaluate((p) => {
    const d = window.__game.world.day;
    d.phase = p;
    d.step(0);
  }, phase);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('->', `${OUT}/${name}.png`);
}

if (errs.length) { console.log('ERREURS :'); errs.slice(0, 5).forEach((e) => console.log(' ', e.slice(0, 200))); }
await browser.close();
