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

/**
 * Ramene le surfeur au sol dans un etat VRAIMENT connu.
 *
 * Remettre `airborne` a false ne suffit pas : a vitesse de croisiere une crete
 * peut le relancer toute seule entre le reset et l'appui, et le test croit
 * alors que l'entree n'a pas repondu. On casse la vitesse pour que le seuil de
 * decollage naturel (courbure x v2) soit hors d'atteinte.
 */
const reset = (page) => page.evaluate(() => {
  const c = window.__game.controller;
  c.airborne = false; c.vy = 0; c.jumpWind = 0; c.y = c.groundY;
  c.speed = 12;
  c.bonus.value = 0;
});

/**
 * Enregistre les decollages a la SOURCE.
 *
 * Lire `vy` un moment apres le relachement mesure ce qu'il en reste, pas
 * l'impulsion : selon le framerate le surfeur est deja retombe, et le test
 * devient instable sans que le jeu n'ait bouge. On s'accroche donc a
 * l'evenement de saut, ou `vy` vaut exactement l'impulsion de depart.
 */
const armRecorder = (page) => page.evaluate(() => {
  const c = window.__game.controller;
  window.__jumps = [];
  const prev = c.events.onJump;
  c.events.onJump = (timed, wind) => {
    window.__jumps.push({ timed: +timed.toFixed(2), wind: +wind.toFixed(2), vy: +c.vy.toFixed(2) });
    prev?.(timed, wind);
  };
});
const takeJumps = (page) => page.evaluate(() => {
  const j = window.__jumps.slice();
  window.__jumps.length = 0;
  return j;
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
  await armRecorder(p);

  // Tap court.
  await reset(p);
  await p.keyboard.down('Space');
  await p.waitForTimeout(70);
  await p.keyboard.up('Space');
  await p.waitForTimeout(500);
  const tapJumps = await takeJumps(p);

  // Maintien long.
  await reset(p);
  await p.keyboard.down('Space');
  await p.waitForTimeout(1400);
  const armed = await peek(p);
  await p.keyboard.up('Space');
  await p.waitForTimeout(500);
  const holdJumps = await takeJumps(p);

  const tap = tapJumps[0];
  const hold = holdJumps[0];

  // Un tap franc DOIT produire un saut, meme minuscule : sinon l'appui a ete
  // perdu entre deux frames et le joueur a l'impression que rien ne repond.
  check('clavier : un tap saute quand meme', !!tap, tap ? `vy=${tap.vy} elan=${tap.wind}` : 'aucun saut');
  check('clavier : maintenir arme', armed.held && armed.wind > 0.5, `elan=${armed.wind}`);
  check('clavier : relacher decolle', !!hold && hold.vy > 0, hold ? `vy=${hold.vy}` : 'aucun saut');
  // On assure sur l'ELAN DELIVRE, pas sur vy : l'impulsion finale inclut la
  // pente du terrain au moment du relachement, qui varie d'un essai a l'autre.
  // Que l'elan se traduise en hauteur est deja couvert, hors navigateur et de
  // facon deterministe, par `check:air`.
  check('clavier : l elan monte avec la duree', !!tap && !!hold && hold.wind > tap.wind + 0.4,
    tap && hold ? `tap elan=${tap.wind} -> maintien elan=${hold.wind}` : 'donnees manquantes');
  await p.close();
}

// ---------- TACTILE ----------
{
  const ctx = await b.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await boot(p);
  await armRecorder(p);
  await reset(p);

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
  await p.waitForTimeout(500);
  const touchJumps = await takeJumps(p);
  const tj = touchJumps[0];

  check('tactile : maintenir arme', armed.held && armed.wind > 0.5, `elan=${armed.wind}`);
  check('tactile : relacher decolle', !!tj && tj.vy > 0 && tj.wind > 0.8,
    tj ? `vy=${tj.vy} elan=${tj.wind}` : 'aucun saut');

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
