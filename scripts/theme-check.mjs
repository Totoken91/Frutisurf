/**
 * Verifie que le jeu ne repond JAMAIS au mode sombre du lecteur.
 *
 * C'etait la cause du flash noir : sans `color-scheme: light`, un lecteur en
 * mode sombre donne au document une toile de fond noire, celle que le
 * navigateur peint sous tout le reste. Elle ne se voit qu'aux hoquets du
 * compositeur — donc jamais dans une capture, et jamais dans la sonde qui lit
 * le tampon WebGL.
 *
 * Le test s'assure aussi que la declaration passe devant un style EN LIGNE :
 * la visionneuse d'artefacts ecrit `documentElement.style.colorScheme` quand le
 * lecteur choisit un theme, et une regle d'auteur normale perdrait contre lui.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const b = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'ECHEC'}  ${name.padEnd(46)} ${detail}`);
};

const ctx = await b.newContext({ colorScheme: 'dark', viewport: { width: 360, height: 640 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2200);

const a = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return { scheme: cs.colorScheme, bg: cs.backgroundColor };
});
check('lecteur en mode sombre : schema force en clair', a.scheme.includes('light') && !a.scheme.includes('dark'), a.scheme);
check('fond de la racine peint explicitement', a.bg !== 'rgba(0, 0, 0, 0)' && a.bg !== 'transparent', a.bg);

// Ce que fait la visionneuse d'artefacts quand le lecteur choisit "sombre".
const b2 = await p.evaluate(() => {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.colorScheme = 'dark';
  return getComputedStyle(document.documentElement).colorScheme;
});
check('passe devant le style EN LIGNE de la visionneuse', b2.includes('light') && !b2.includes('dark'), b2);

// L'interface ne doit plus animer de proprietes qui repeignent : on verifie que
// la jauge passe bien par une transformation.
const c = await p.evaluate(() => {
  const el = document.querySelector('.boost > i');
  return el ? getComputedStyle(el).transform : 'absent';
});
check('jauge de boost animee en transformation', c.startsWith('matrix'), c);

// Le pool de points volants doit etre resident, pas cree a la volee.
const d = await p.evaluate(() => document.querySelectorAll('.pops .pop').length);
check('pool de points volants resident', d >= 10, `${d} noeuds`);

// Les points doivent bien s'animer sur le compositeur, et la position doit
// passer par le transform : `left`/`top` declencheraient une mise en page.
const e = await p.evaluate(() => {
  window.__game.hud.pop('+250', 120, 300, '');
  const el = [...document.querySelectorAll('.pops .pop')].find((n) => n.textContent === '+250');
  if (!el) return { ok: false, why: 'aucun noeud pris dans le pool' };
  const anims = el.getAnimations();
  return {
    ok: anims.length > 0 && el.style.left === '',
    why: `${anims.length} animation(s), left="${el.style.left}"`,
  };
});
check('points volants animes sur le compositeur', e.ok, e.why);

// La jauge de boost doit avoir une largeur reelle : une transition CSS
// par-dessus une valeur reecrite en continu la laissait bloquee a zero.
const f = await p.evaluate(() => {
  const el = document.querySelector('.boost > i');
  const w = el.getBoundingClientRect().width;
  const pw = el.parentElement.getBoundingClientRect().width;
  return { r: pw > 0 ? w / pw : 0, boost: window.__game.state.boost };
});
check('jauge de boost a la bonne longueur', Math.abs(f.r - f.boost) < 0.12,
  `${(f.r * 100) | 0} % pour ${(f.boost * 100) | 0} % de jauge`);

await b.close();
const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} echec(s) : ${bad.map((r) => r.name).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nOK — le jeu reste en plein jour quel que soit le theme du lecteur.');
}
