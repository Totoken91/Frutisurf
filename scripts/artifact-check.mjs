/**
 * LA VERSION PUBLIEE DEMARRE-T-ELLE ?
 *
 * Cette question n'avait jamais ete posee, et c'est ce qui a coute une version
 * livree morte. Toute la suite — captures, shaders, entrees, flicker, mondes —
 * tournait sur `index.html`, servi par Vite. L'artefact mono-fichier, lui, est
 * assemble par un script qui construisait sa PROPRE coquille HTML. Le jour ou
 * l'ecran d'equipement a ajoute un `<div id="pick">` a `index.html`, la coquille
 * ne l'a pas suivi : le module mourait sur un `Cannot set properties of null`
 * avant la premiere image, et la page publiee affichait un aplat cyan fige avec
 * le HUD dessus.
 *
 * Zero test echouait. C'est la definition d'un angle mort.
 *
 * Ce banc charge le fichier REELLEMENT publie et exige quatre choses :
 *   1. aucune exception de page — c'est elle qui tuait tout ;
 *   2. le jeu est instancie et expose ;
 *   3. tous les noeuds que le code va chercher par identifiant existent ;
 *   4. la simulation AVANCE — un jeu qui boote et se fige n'est pas un jeu.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const FILE = process.env.ARTIFACT ?? 'dist-single/artifact.html';

// --- Serveur minimal. On sert le FICHIER, pas un dossier de build : c'est
//     exactement l'octet qui part chez le joueur qu'on veut charger.
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  try {
    const path = url === '/' ? FILE : join('dist-single', url);
    const body = readFileSync(path);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
      '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[extname(path)] ?? 'text/plain';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4319, r));

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:4319/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name.padEnd(40)} ${detail}`);
};

check('aucune exception au chargement', errs.length === 0, errs[0]?.slice(0, 120) ?? '');

const state = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  return {
    ids: ['stage', 'hud', 'pick'].filter((id) => !document.getElementById(id)),
    z0: g.controller.z,
    fps: g.state.fps,
    monde: g.world.world.id,
  };
});
check('le jeu est instancie', !!state, state ? '' : 'window.__game absent');

if (state) {
  check('les noeuds attendus existent', state.ids.length === 0,
    state.ids.length ? `manquants : ${state.ids.join(', ')}` : 'stage, hud, pick');

  // On valide l'equipement comme un joueur : c'est la seule sortie de l'ecran,
  // et tant qu'il est ouvert le chrono est gele — mesurer avant reviendrait a
  // constater que le jeu est en pause, ce qu'il doit etre.
  await page.click('.pickgo u', { force: true });
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !window.__game.select.isOpen);
  check('valider ferme l ecran', closed);

  // On ATTEND le progres, on ne le chronometre pas.
  //
  // Le banc tourne sur un rasteriseur logiciel, a une image ou deux par
  // seconde : un seuil exprime en metres par seconde y echouerait toujours,
  // et le regler pour passer ici le rendrait aveugle sur une vraie machine.
  // La question est binaire — le jeu avance-t-il, oui ou non — donc on lui
  // laisse le temps qu'il faut et on echoue seulement s'il n'avance jamais.
  const z1 = await page.evaluate(() => window.__game.controller.z);
  const t1 = await page.evaluate(() => window.__game.run.timeLeft);
  const budget = 30000;
  const started = Date.now();
  let after = null;
  while (Date.now() - started < budget) {
    await page.waitForTimeout(700);
    after = await page.evaluate(() => ({
      z: window.__game.controller.z,
      fps: window.__game.state.fps,
      temps: window.__game.run.timeLeft,
    }));
    if (after.z < z1 - 60 && after.temps < t1 - 2) break;
  }
  check('la simulation avance', after.z < z1 - 60, `${(z1 - after.z).toFixed(0)} m parcourus`);
  check('le chrono tourne', after.temps < t1 - 2, `${after.temps.toFixed(1)} s restantes`);
  // Et le MEME raisonnement s'applique a la cadence, ce que le premier jet
  // avait oublie : le seuil etait a 0,5 image par seconde, c'est-a-dire pile
  // sur la valeur que ce rasteriseur logiciel produit. Deux lancements de
  // suite sur un fichier identique donnaient 0,5 puis 0,4 — un banc qui
  // depend de la charge de la machine plutot que du code n'est pas un banc,
  // c'est un tirage au sort, et on finit par ignorer ses echecs.
  //
  // La question reste binaire : la boucle de rendu produit-elle des images ?
  // Une boucle morte rapporte zero. Le seuil est donc pose loin sous la
  // valeur de travail, la ou il ne distingue plus que le vivant du mort.
  check('le rendu tourne', after.fps > 0.15, `${after.fps.toFixed(1)} img/s (rasteriseur logiciel)`);
}

if (errs.length) {
  console.log('\nEXCEPTIONS :');
  errs.slice(0, 3).forEach((e) => console.log(' ', e.slice(0, 200)));
}
console.log(bad ? `\n${bad} echec(s) — la version publiee est cassee.` : '\nOK — la version publiee demarre et tourne.');
await browser.close();
server.close();
process.exitCode = bad ? 1 : 0;
