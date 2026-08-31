/**
 * Capture TOUS les etats de l'interface, pas seulement l'ecran au repos.
 *
 * Une interface de jeu passe l'essentiel de son temps dans des etats qu'une
 * capture ordinaire ne montre jamais : chrono critique, multiplicateur affiche,
 * banniere de figure, panneau de fin. Ce sont precisement ceux qui portent le
 * plus de matiere — et donc ceux ou une faute se voit le plus.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedLoadout } from './lib/boot.mjs';

const OUT = 'shots/ui';
mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W ?? 390);
const H = Number(process.env.H ?? 844);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await seedLoadout(page);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

/** Fige la simulation : on ne veut mesurer que l'interface. */
await page.evaluate(() => {
  const g = window.__game;
  const c = g.controller;
  const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
  for (let i = 0; i < 2400; i++) { c.speed = 38; c.step(1 / 120, pad); }
  const f = { x: c.x, y: c.y, z: c.z, speed: c.speed };
  c.step = () => { c.x = f.x; c.y = f.y; c.z = f.z; c.speed = f.speed; };
  g.rig.snap(c);
  g.rig.update = () => {};
});

const shot = async (name, setup) => {
  await page.evaluate(setup);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('->', `${OUT}/${name}.png`);
};

await shot('01-course', () => {
  const g = window.__game;
  g.run.timeLeft = 26.4;
  g.controller.score = 18420;
  g.run.best = 41300;
  g.controller.boost = 0.62;
  g.state.mult = 1;
});

await shot('02-multiplicateur', () => {
  const g = window.__game;
  g.run.timeLeft = 19.8;
  g.controller.score = 74600;
  g.controller.combo = 7;
  g.controller.comboTimer = 3;
  g.controller.boost = 0.88;
});

await shot('03-boost', () => {
  const g = window.__game;
  g.controller.boosting = true;
  g.controller.boost = 0.74;
  g.run.timeLeft = 15.2;
});

await shot('04-chrono-critique', () => {
  const g = window.__game;
  g.controller.boosting = false;
  g.run.timeLeft = 2.7;
  g.controller.score = 128400;
});

await shot('05-banniere', () => {
  const g = window.__game;
  g.run.timeLeft = 12.6;
  g.hud.banner('720°', '+4 200', 'trick');
});

await shot('06-banniere-eau', () => {
  const g = window.__game;
  g.hud.banner('GLISSE 62m', '+1 840', 'wet');
});

await shot('07-fin', () => {
  const g = window.__game;
  g.run.finalScore = 214760;
  g.run.best = 198300;
  g.run.rings = 34;
  g.run.bestCombo = 21;
  g.run.recordBeaten = true;
  g.hud.showOver(g.run, 4820);
});

if (errs.length) { console.log('ERREURS :'); errs.slice(0, 5).forEach((e) => console.log(' ', e.slice(0, 200))); }
await browser.close();
