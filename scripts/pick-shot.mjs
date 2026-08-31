/**
 * Capture l'ecran d'equipement, et les trois montures en jeu.
 *
 * Deux choses a verifier, et elles ne se voient pas sur la meme image :
 *  - l'ECRAN tient-il sur un telephone en portrait sans defilement, avec ses
 *    six cartes, ses cinq jauges et son bouton ;
 *  - le choix se VOIT-il ensuite dans la partie. Un menu qui ne change rien a
 *    l'ecran suivant est un menu qui ment, et c'est la faute que ces captures
 *    doivent rendre impossible a rater.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots/pick';
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
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);

// --- L'ecran, tel qu'il s'ouvre au premier lancement.
await page.evaluate(() => window.__game.select.open());
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/00-defaut.png` });

// --- Une combinaison extreme dans chaque sens : c'est la que les jauges
//     signees doivent se lire d'un coup, et que les etiquettes doivent etre
//     coherentes avec elles.
const set = async (r, m, name) => {
  await page.evaluate(([ri, mi]) => {
    const s = window.__game.select;
    s.pick(0, ri);
    s.pick(1, mi);
  }, [r, m]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('->', name);
};
await set(1, 1, '01-neon-vinyle');
await set(2, 2, '02-givre-minidisc');

// --- Et en jeu : les trois montures, vues de la camera de course.
const inGame = async (r, m, name) => {
  await page.evaluate(([ri, mi]) => {
    const g = window.__game;
    g.select.pick(0, ri);
    g.select.pick(1, mi);
    g.select.confirm();
    const c = g.controller;
    const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
    for (let i = 0; i < 1400; i++) { c.speed = 34; c.step(1 / 120, pad); }
    g.run.timeLeft = 9999;
    g.rig.snap(c);
  }, [r, m]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('->', name);
};
await inGame(0, 0, '10-jeu-bleu-cd');
await inGame(1, 1, '11-jeu-neon-vinyle');
await inGame(2, 2, '12-jeu-givre-minidisc');

if (errs.length) { console.log('ERREURS :'); errs.slice(0, 6).forEach((e) => console.log(' ', String(e).slice(0, 200))); }
await browser.close();
