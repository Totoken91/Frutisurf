/**
 * Le parcours d'equipement, du point de vue du DOIGT.
 *
 * Tout le reste de la suite pilote le jeu par `window.__game`, ce qui ne prouve
 * rien sur un ecran dont l'unique interface est le clic. Trois choses peuvent
 * casser ici sans qu'aucun autre banc ne s'en apercoive, et elles cassent le
 * PREMIER ecran que voit un nouveau joueur :
 *
 *   1. l'ecran s'ouvre-t-il au tout premier lancement, et seulement la ;
 *   2. un clic sur une carte puis sur « c'est parti » ferme-t-il l'ecran,
 *      applique-t-il le choix a la physique ET a la livree, et relance-t-il ;
 *   3. le choix survit-il au rechargement — sinon la persistance ne sert a
 *      rien et le joueur re-choisit a chaque partie.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name.padEnd(42)} ${detail}`);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);

check('s ouvre au premier lancement', await page.evaluate(() => window.__game.select.isOpen));

// --- On choisit a la souris, comme un joueur : NEON (rangee 0, carte 1) et
//     MINIDISC (rangee 1, carte 2).
await page.click('.card[data-row="0"][data-i="1"]');
await page.click('.card[data-row="1"][data-i="2"]');
await page.waitForTimeout(350);

const before = await page.evaluate(() => {
  const g = window.__game;
  return { rider: g.select.loadout.rider.id, mount: g.select.loadout.mount.id };
});
check('les cartes changent la selection', before.rider === 'neon' && before.mount === 'minidisc',
  `${before.rider} / ${before.mount}`);

// Le bouton respire en boucle (animation `cta`), donc Playwright ne le juge
// jamais « stable ». On verifie sa visibilite explicitement, puis on force le
// clic : c'est la stabilite geometrique qu'on contourne, pas l'actionnabilite.
check('le bouton de validation est visible', await page.isVisible('.pickgo u'));
await page.click('.pickgo u', { force: true });
await page.waitForTimeout(600);

const after = await page.evaluate(() => {
  const g = window.__game;
  return {
    open: g.select.isOpen,
    rider: g.controller.loadout.rider.id,
    mount: g.controller.loadout.mount.id,
    lift: g.controller.loadout.lift,
    // La livree doit avoir suivi la physique : c'est le seul moyen de prendre
    // un ecran qui promet une monture et n'en livre pas une autre.
    tintTop: g.surfer.buddy.tint.top.getHexString(),
    distance: g.controller.distance,
    phase: g.run.phase,
  };
});
check('valider ferme l ecran', !after.open);
check('le choix atteint la physique', after.rider === 'neon' && after.mount === 'minidisc',
  `${after.rider} / ${after.mount} lift=${after.lift.toFixed(2)}`);
// BLEU vaut 0a8fe8 : si la teinte est restee dessus, la livree n'a pas suivi.
check('le choix atteint la livree', after.tintTop !== '0a8fe8', `top=#${after.tintTop}`);
check('valider relance la partie', after.phase === 'running' && after.distance < 40,
  `${after.phase} ${after.distance.toFixed(1)} m`);

// --- Rechargement : le choix doit tenir, et l'ecran ne doit PLUS s'ouvrir.
await page.reload({ waitUntil: 'networkidle' });

await page.waitForTimeout(2600);
const back = await page.evaluate(() => {
  const g = window.__game;
  return { open: g.select.isOpen, rider: g.controller.loadout.rider.id, mount: g.controller.loadout.mount.id };
});
check('ne se rouvre pas au retour', !back.open);
check('le choix a survecu au rechargement', back.rider === 'neon' && back.mount === 'minidisc',
  `${back.rider} / ${back.mount}`);

if (errs.length) {
  bad += errs.length;
  console.log('\nERREURS PAGE :');
  errs.slice(0, 4).forEach((e) => console.log(' ', e.slice(0, 160)));
}
console.log(bad ? `\n${bad} echec(s).` : '\nOK — l ecran d equipement s ouvre, applique et persiste.');
await browser.close();
process.exitCode = bad ? 1 : 0;
