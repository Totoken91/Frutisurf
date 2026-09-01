/**
 * LA GALERIE : chaque monture, chaque livree, et l'aura.
 *
 * Six montures et six personnages ne se jugent pas un par un : la seule
 * question qui vaille est de savoir si on les distingue COTE A COTE. Une
 * capture par option, prises dans des conditions identiques — meme heure, meme
 * position, meme cadrage — pour que la seule difference visible soit celle
 * qu'on a voulue.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedLoadout } from './lib/boot.mjs';

const OUT = 'shots/gallery';
mkdirSync(OUT, { recursive: true });
const KIND = process.env.KIND ?? 'mount';
const WORLD = process.env.GWORLD ?? 'plaine';
const PHASE = process.env.GPHASE ? Number(process.env.GPHASE) : 0.19;
const AURA = process.env.AURA === '1';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 460, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION/.test(m.text())) errs.push(m.text()); });
await seedLoadout(page, 'bleu', 'cd', WORLD);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2800);

const ids = await page.evaluate((k) => window.__loadout[k === 'mount' ? 'MOUNTS' : 'RIDERS'].map((p) => p.id), KIND);

for (const id of ids) {
  await page.evaluate(([k, who, ph, aura]) => {
    const g = window.__game;
    g.world.day.phase = ph;
    g.world.day.step(0);
    const L = window.__loadout;
    const rider = k === 'mount' ? L.RIDERS[0] : L.RIDERS.find((p) => p.id === who);
    const mount = k === 'mount' ? L.MOUNTS.find((p) => p.id === who) : L.MOUNTS[0];
    g.controller.loadout = L.combine(rider, mount, g.world.world.mods);
    g.surfer.setLoadout(rider.id, mount.id);
    const c = g.controller;
    c.reset();
    const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
    // Position IDENTIQUE pour toutes les captures : la seule difference doit
    // etre l'option, jamais le terrain sous les pieds.
    for (let i = 0; i < 2400; i++) { c.speed = aura ? 60 : 30; c.step(1 / 120, pad); }
    c.y = c.groundY;
    c.onWater = false; c.planing = false; c.sunk = false;
    g.run.timeLeft = 9999;
    const f = { x: c.x, y: c.y, z: c.z, speed: aura ? 60 : 30 };
    c.step = () => { c.x = f.x; c.y = f.y; c.z = f.z; c.speed = f.speed; };
    // On coupe la gerbe. Le surfeur est FIGE : en jeu les particules filent
    // derriere lui, ici elles s'entassent toutes au meme endroit et noient le
    // bas de l'image sous un tapis blanc. C'est un artefact du banc, pas du
    // jeu, et le laisser rendrait chaque capture illisible.
    g.spray.emit = () => {};
    g.spray.burst = () => {};
    g.rig.snap(c);
  }, [KIND, id, PHASE, AURA]);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/${KIND}-${id}${AURA ? '-aura' : ''}.png` });
  console.log('->', id);
}
if (errs.length) { console.log('ERREURS :'); errs.slice(0, 4).forEach((e) => console.log(' ', String(e).slice(0, 180))); }
await browser.close();
