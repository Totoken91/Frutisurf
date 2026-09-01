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
 *
 * Et deux de plus, qui sont des defauts signales par le joueur :
 *
 *   4. LE JEU NE DOIT PAS SE JOUER TOUT SEUL derriere le panneau. Le surfeur
 *      filait a trente metres par seconde pendant qu'on lisait les libelles :
 *      au premier lancement, le temps de choisir, on avait deja traverse un
 *      kilometre de plaine. Le chrono etait gele, mais rien d'autre.
 *   5. ON DOIT POUVOIR REVENIR AU MENU quand on veut, et en REPARTIR sans y
 *      laisser sa course. Le panneau n'avait qu'une issue, « c'est parti »,
 *      qui relance la partie.
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

// --- 4. LE JEU EST-IL A L'ARRET DERRIERE LE PANNEAU ?
//
//     On mesure la DISTANCE parcourue pendant qu'on ne fait rien, sur une
//     seconde et demie. A vitesse de croisiere c'etait une trentaine de
//     metres ; le seuil est pose a un metre, ce qui laisse passer le
//     tassement du disque sur le sol mais rien qui ressemble a une course.
const still0 = await page.evaluate(() => window.__game.controller.distance);
await page.waitForTimeout(1500);
const still1 = await page.evaluate(() => ({
  d: window.__game.controller.distance,
  score: window.__game.controller.score,
}));
check('le jeu ne joue pas derriere le menu', still1.d - still0 < 1,
  `${(still1.d - still0).toFixed(2)} m en 1,5 s`);
check('et il ne marque pas de points', still1.score < 1, `score ${still1.score.toFixed(0)}`);

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

// --- 5. LE RETOUR AU MENU, en cours de partie, et la sortie sans degat.
//
//     Le bouton vit dans la bande haute du HUD. On le clique comme un joueur,
//     on change de monde pour verifier que l'annulation le remet en place, et
//     on ressort par la croix : la partie doit reprendre ou elle en etait,
//     avec le monde d'avant.
await page.waitForTimeout(900);
const runBefore = await page.evaluate(() => ({
  d: window.__game.controller.distance,
  world: window.__game.world.world.id,
  left: window.__game.run.timeLeft,
}));
await page.click('[data-el="menu"]');
await page.waitForTimeout(400);
check('le bouton du HUD rouvre le menu', await page.evaluate(() => window.__game.select.isOpen));

// On survole un autre monde : il s'applique tout de suite, c'est le principe
// de l'ecran. L'annulation doit donc le defaire.
await page.click('.wcard[data-world="3"]');
await page.waitForTimeout(300);
check('survoler un monde l applique', await page.evaluate(() => window.__game.world.world.id) === 'chrome');

await page.click('[data-el="close"]');
await page.waitForTimeout(900);
const runAfter = await page.evaluate(() => ({
  open: window.__game.select.isOpen,
  d: window.__game.controller.distance,
  world: window.__game.world.world.id,
  left: window.__game.run.timeLeft,
  phase: window.__game.run.phase,
}));
check('la croix ferme le menu', !runAfter.open);
check('annuler remet le monde d avant', runAfter.world === runBefore.world,
  `${runBefore.world} -> ${runAfter.world}`);
// La course REPREND : elle n'a pas ete relancee (la distance n'est pas
// retombee a zero) et elle n'est pas restee gelee (elle a repris de la route).
check('la course reprend ou elle en etait',
  runAfter.phase === 'running' && runAfter.d > runBefore.d + 3,
  `${runBefore.d.toFixed(0)} m -> ${runAfter.d.toFixed(0)} m`);
// Le chrono etait gele pendant le choix : il ne doit pas avoir fondu.
check('le chrono ne coule pas pendant le choix', runBefore.left - runAfter.left < 2.5,
  `${runBefore.left.toFixed(1)} s -> ${runAfter.left.toFixed(1)} s`);

// Echap fait la meme chose, et c'est la SEULE bascule : deux ecouteurs sur le
// meme evenement se seraient annules l'un l'autre (fermer puis rouvrir).
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
check('Echap ouvre le menu', await page.evaluate(() => window.__game.select.isOpen));
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
check('Echap le referme', !(await page.evaluate(() => window.__game.select.isOpen)));

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
