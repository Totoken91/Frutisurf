/**
 * Le joueur EN PLEINE MER, la ou la houle se juge.
 *
 * Les captures de monde cadrent depuis la terre pour montrer le paysage ; elles
 * ne disent rien de ce qu'on ressent au milieu de l'ocean, qui est pourtant la
 * ou l'on passe les deux tiers du temps. Celle-ci va chercher un point d'eau
 * PROFONDE et laisse la simulation tourner : c'est le seul moyen de voir si la
 * vague porte le disque au lieu de le traverser.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedLoadout } from './lib/boot.mjs';

const OUT = 'shots/ocean';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 780, height: 1200 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await seedLoadout(page, 'bleu', 'cd', 'okinawa');
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2800);

const PHASES = process.env.PHASES ? process.env.PHASES.split(',').map(Number) : [0.22];
for (const phase of PHASES) {
  const info = await page.evaluate((ph) => {
    const g = window.__game;
    g.world.day.phase = ph;
    g.world.day.step(0);
    const c = g.controller;
    c.reset();
    const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
    // On cherche de l'eau VRAIMENT profonde, loin de toute rive.
    for (let k = 0; k < 20000; k++) {
      c.speed = 40;
      c.step(1 / 120, pad);
      if (k > 600 && c.planing && window.__depth(c.x, c.z - 140) > 6) break;
    }
    g.run.timeLeft = 9999;
    g.rig.snap(c);
    return { z: Math.round(c.z), planing: c.planing, y: +c.y.toFixed(2), vagues: c.waves };
  }, phase);
  // On laisse tourner : la houle doit AVANCER, et le disque monter avec elle.
  await page.waitForTimeout(3200);
  const after = await page.evaluate(() => ({ vagues: window.__game.controller.waves, y: +window.__game.controller.y.toFixed(2) }));
  await page.screenshot({ path: `${OUT}/p${phase}.png` });
  console.log(`phase ${phase} :`, JSON.stringify(info), '->', JSON.stringify(after));
}
if (errs.length) { console.log('ERREURS :'); errs.slice(0, 4).forEach((e) => console.log(' ', String(e).slice(0, 180))); }
await browser.close();
