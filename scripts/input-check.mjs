/**
 * Test bout-en-bout de la COUCHE D'ENTREE, dans un vrai navigateur.
 *
 * Les controles automatiques de gameplay pilotent `jumpHeld` directement : ils
 * valident le modele de saut, jamais le chemin evenement -> Input -> Controller.
 * C'est exactement la ou le saut tactile s'est casse sans que rien ne le voie.
 */
import { chromium, devices } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'ECHEC'}  ${name.padEnd(38)} ${detail}`);
};

async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Laisser passer la compilation des shaders : les premieres images sont
  // tres lentes et fausseraient toute mesure de duree.
  await page.waitForTimeout(2600);
  await page.evaluate(() => { window.__game.controller.hitstop = 0; });
}

/** Ramene le surfeur au sol, a plat, pour repartir d'un etat connu. */
const reset = (page) => page.evaluate(() => {
  const c = window.__game.controller;
  c.airborne = false; c.vy = 0; c.jumpWind = 0; c.y = c.groundY;
});
const peek = (page) => page.evaluate(() => {
  const c = window.__game.controller;
  return { air: c.airborne, wind: +c.jumpWind.toFixed(2), vy: +c.vy.toFixed(2),
           held: window.__game.input.jumpHeld, steer: +c.steer.value.toFixed(2),
           boost: +c.boost.toFixed(2), gliding: c.gliding };
});

// ---------- CLAVIER ----------
{
  const p = await b.newPage({ viewport: { width: 420, height: 720 } });
  await boot(p);
  // Tap court.
  await reset(p);
  await p.keyboard.down('Space');
  await p.waitForTimeout(70);
  await p.keyboard.up('Space');
  await p.waitForTimeout(700);
  const tapped = await peek(p);

  // Maintien long. On compare les DEUX plutot que de mesurer une duree absolue :
  // sous rendu logiciel le framerate varie trop pour qu'un seuil ait un sens.
  await reset(p);
  await p.keyboard.down('Space');
  await p.waitForTimeout(1400);
  const armed = await peek(p);
  await p.keyboard.up('Space');
  await p.waitForTimeout(700);
  const flying = await peek(p);

  // Un tap franc DOIT produire un saut, meme minuscule : sinon l'appui a ete
  // perdu entre deux frames et le joueur a l'impression que rien ne repond.
  check('clavier : un tap saute quand meme', tapped.air || tapped.vy > 0,
    `enVol=${tapped.air} vy=${tapped.vy}`);
  check('clavier : maintenir arme', armed.held && armed.wind > tapped.wind, `elan=${armed.wind}`);
  check('clavier : relacher decolle', flying.air && flying.vy > 0, `vy=${flying.vy}`);
  check('clavier : l elan paie', flying.vy > tapped.vy * 1.25,
    `tap vy=${tapped.vy} -> maintien vy=${flying.vy}`);
  await p.close();
}

// ---------- TACTILE ----------
{
  const ctx = await b.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await boot(p);

  // Doigt pose et maintenu au centre, sans glisser.
  await p.touchscreen.tap(195, 400);
  await p.waitForTimeout(60);
  await p.evaluate(() => {
    const t = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target: document.getElementById('stage'),
        clientX: x, clientY: y });
      document.getElementById('stage').dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch], targetTouches: type === 'touchend' ? [] : [touch],
        bubbles: true, cancelable: true }));
    };
    window.__t = t;
    t('touchstart', 195, 400);
  });
  await p.waitForTimeout(1400);
  const armed = await peek(p);
  await p.evaluate(() => window.__t('touchend', 195, 400));
  await p.waitForTimeout(700);
  const flying = await peek(p);

  check('tactile : maintenir arme', armed.held && armed.wind > 0.2, `elan=${armed.wind}`);
  check('tactile : relacher decolle', flying.air && flying.vy > 0, `vy=${flying.vy}`);

  // Le doigt repose en vol doit declencher le plane. On place directement le
  // surfeur a l'apex : sous rendu logiciel, attendre qu'il y arrive tout seul
  // mesurerait le framerate, pas la mecanique.
  await p.evaluate(() => {
    const c = window.__game.controller;
    c.airborne = true; c.vy = 0; c.y = c.groundY + 12; c.liftUsed = false;
  });
  await p.evaluate(() => window.__t('touchstart', 195, 400));
  await p.waitForTimeout(600);
  const soaring = await peek(p);
  check('tactile : re-appui plane', soaring.gliding, `plane=${soaring.gliding}`);
  await p.evaluate(() => window.__t('touchend', 195, 400));
  await reset(p);

  // Glissement lateral = direction, et ca doit toujours armer.
  await p.evaluate(() => window.__t('touchstart', 195, 400));
  await p.waitForTimeout(60);
  await p.evaluate(() => window.__t('touchmove', 320, 400));
  await p.waitForTimeout(600);
  const steered = await peek(p);
  await p.evaluate(() => window.__t('touchend', 320, 400));
  check('tactile : glisser dirige', Math.abs(steered.steer) > 0.3, `steer=${steered.steer}`);
  await p.close();
}

await b.close();
const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} echec(s) : ${bad.map((r) => r.name).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nOK — clavier et tactile arment et declenchent le saut.');
}
