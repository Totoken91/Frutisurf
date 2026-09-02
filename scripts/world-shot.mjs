/**
 * Chaque monde, vu de la camera de course, plus l'ecran de selection.
 *
 * Un monde ne se juge pas sur ses chiffres : ce qui compte est qu'on le
 * reconnaisse en une image, sans lire son nom. Les quatre captures cote a cote
 * repondent a la seule question qui vaille — sont-ils VRAIMENT differents, ou
 * est-ce la meme plaine repeinte quatre fois.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedLoadout } from './lib/boot.mjs';

const OUT = 'shots/worlds';
mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W ?? 780);
const H = Number(process.env.H ?? 1200);
const PHASE = process.env.PHASE ? Number(process.env.PHASE) : null;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await seedLoadout(page);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2800);

const ids = await page.evaluate(() => window.__worlds.map((w) => w.id));

for (let i = 0; i < ids.length; i++) {
  await page.evaluate(([idx, phase]) => {
    const g = window.__game;
    g.world.setWorld(window.__worlds[idx], true);
    if (phase !== null) { g.world.day.phase = phase; g.world.day.step(0); }
    const c = g.controller;
    c.reset();
    const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
    // On avance jusqu'a un point qui MONTRE le monde : de la terre sous les
    // pieds, et de l'eau dans le cadre s'il y en a. S'arreter au hasard donne
    // quatre captures de prairie et ne prouve rien.
    let best = null;
    for (let k = 0; k < 6000; k++) {
      c.speed = 34;
      c.step(1 / 120, pad);
      if (k > 400 && !c.onWater) {
        let sea = 0;
        for (let d = 20; d < 220; d += 10) if (window.__depth(c.x, c.z - d) > 0.5) sea++;
        if (sea >= 4) { best = { x: c.x, y: c.y, z: c.z }; break; }
      }
    }
    if (best) { c.x = best.x; c.z = best.z; }
    // On repose le surfeur sur le SOL, pas sur `groundY`.
    //
    // `groundY` vaut le niveau de l'EAU des que le surfeur plane, et le point
    // de cadrage choisi est justement au bord du lagon. Le poser dessus
    // l'enfoncait de deux metres sous le sable, et les captures d'Okinawa
    // montraient un buddy a moitie enterre — un defaut du banc que j'ai
    // d'abord pris pour un defaut du monde.
    c.y = window.__height(c.x, c.z);
    c.onWater = false;
    c.planing = false;
    c.sunk = false;
    g.run.timeLeft = 9999;
    const f = { x: c.x, y: c.y, z: c.z, speed: c.speed };
    c.step = () => { c.x = f.x; c.y = f.y; c.z = f.z; c.speed = f.speed; };
    // On fige le SURFEUR, pas la CAMERA.
    //
    // Les figer tous les deux paraissait plus stable et donnait des captures
    // fausses : `snap` pose la camera a sa position nominale, alors qu'en jeu
    // elle vit sur des ressorts et se stabilise un peu plus haut et un peu plus
    // en arriere. Gelee au snap, elle passait sous la ligne d'herbe et le
    // surfeur se retrouvait a moitie enterre — un defaut du banc, pas du jeu.
    // On laisse donc la camera converger, et on attend qu'elle soit posee.
    g.rig.snap(c);

    // --- ON EFFACE LES TRACES DU BANC, PAS CELLES DU JEU.
    //
    //     Geler le surfeur fait s'accumuler tout ce qui le SUIT : la gerbe et
    //     le ruban s'empilent au meme endroit image apres image, et le ruban
    //     finit par barrer le cadre d'une echarpe pale. On a deja pris cet
    //     artefact pour un defaut du monde une fois (c'etait la gerbe, sur
    //     l'ocean) ; il coute une demi-heure a chaque fois qu'on l'oublie.
    //     Et SILENCER la gerbe ne suffit pas : les particules deja emises
    //     pendant les six mille pas de reperage restent en l'air et se figent
    //     avec le surfeur. Empilees, elles font une plaque TURQUOISE a bord
    //     droit dans un coin du cadre — sur un monde d'octobre, la seule chose
    //     cyan de l'image. On la masque comme le ruban et l'aura.
    g.spray.emit = () => {};
    g.spray.burst = () => {};
    g.spray.mesh.visible = false;
    g.trail.mesh.visible = false;
    g.aura.mesh.visible = false;
  }, [i, PHASE]);
  await page.waitForTimeout(2400);
  const tag = PHASE !== null ? `-p${PHASE}` : '';
  await page.screenshot({ path: `${OUT}/${i}-${ids[i]}${tag}.png` });
  console.log('->', `${ids[i]}${tag}`);
}

// L'ecran de selection, avec sa rangee de mondes.
await page.evaluate(() => { window.__game.select.open(); });
await page.waitForTimeout(600);
await page.evaluate(() => { window.__game.select.pick(2, 1); });
// Le fondu de monde dure 1,15 s et l'ouverture du panneau 0,42 s : capturer
// plus tot photographie une transition, pas un ecran.
await page.waitForTimeout(2400);
await page.screenshot({ path: `${OUT}/9-selection.png` });
console.log('-> selection');

if (errs.length) { console.log('ERREURS :'); errs.slice(0, 6).forEach((e) => console.log(' ', String(e).slice(0, 200))); }
await browser.close();
