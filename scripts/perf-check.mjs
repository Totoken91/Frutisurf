/**
 * Profil par SOUSTRACTION, et detecteur d'objets qui traversent la camera.
 *
 * Deux mesures, une seule session de jeu, parce que les deux plaintes sont
 * liees : a vingt images par seconde, un objet qui bouche l'objectif pendant
 * deux images occupe cent millisecondes d'ecran. Ce qu'on appelle « un flash »
 * a bas regime est souvent un objet trop proche vu trop longtemps.
 *
 * 1. LE COUT. On ne devine pas ce qui est cher : on cache un maillage et on
 *    regarde ce que la frame reprend. Le rendu logiciel est lie au fragment,
 *    exactement comme un GPU de telephone faible, donc les ecarts RELATIFS se
 *    transposent meme si les valeurs absolues n'ont aucun sens.
 *
 * 2. LA DISTANCE. Chaque image, on releve la distance de la camera a la
 *    surface la plus proche de chaque famille d'objets. Une valeur negative
 *    veut dire que la camera est DEDANS — et un plan translucide double-face
 *    dans lequel on entre remplit tout le cadre.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const SECONDS = Number(process.env.SECONDS ?? 30);
const W = Number(process.env.W ?? 420);
const H = Number(process.env.H ?? 760);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// --- On FIGE la scene avant de chronometrer.
//
// Sans ca chaque configuration etait mesuree a un endroit different du
// parcours — relief different, objets differents a l'ecran — et l'ecart entre
// deux decors depassait largement l'economie qu'on cherchait a mesurer. Cacher
// la ville semblait faire gagner 27 %, ce qui est absurde pour une silhouette
// a l'horizon.
const freeze = async () => {
  await page.evaluate(() => {
    const g = window.__game;
    const c = g.controller;
    const pad = { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false };
    // On avance jusqu'a un point representatif : de l'herbe, du relief, la
    // ville en vue. Cinq cents metres suffisent a sortir du plat du depart.
    for (let i = 0; i < 3000; i++) { c.speed = 34; c.step(1 / 120, pad); }
    g.run.timeLeft = 9999;
    const f = { x: c.x, y: c.y, z: c.z, speed: c.speed };
    c.step = () => { c.x = f.x; c.y = f.y; c.z = f.z; c.speed = f.speed; };
    g.rig.snap(c);
    g.rig.update = () => {};
  });
};

// --- Instrumentation commune : chronometre de frame + distances a la camera.
await page.evaluate(() => {
  const g = window.__game;
  const rec = { ms: [], near: {}, frames: 0 };
  window.__perf = rec;

  const note = (name, d) => {
    const s = (rec.near[name] ??= { min: 1e9, inside: 0 });
    if (d < s.min) s.min = d;
    if (d < 0) s.inside++;
  };

  // On chronometre l'INTERVALLE entre images, pas la duree de l'appel.
  // `render()` ne fait qu'empiler des commandes et rend la main avant que le
  // travail soit fait : mesurer sa duree revient a mesurer le temps de
  // preparation cote JS, qui n'est pas le sujet.
  const orig = g.post.render.bind(g.post);
  let last = 0;
  g.post.render = (dt) => {
    orig(dt);
    const t = performance.now();
    if (last) rec.ms.push(t - last);
    last = t;
    rec.frames++;

    const cam = g.engine.camera.position;
    const w = g.world;

    // Les tableaux d'instances sont prives : on les lit par la matrice
    // d'instance, qui est publique et porte deja la position monde.
    const readPos = (mesh, i, out) => {
      const a = mesh.instanceMatrix.array;
      out.x = a[i * 16 + 12]; out.y = a[i * 16 + 13]; out.z = a[i * 16 + 14];
    };
    const p = { x: 0, y: 0, z: 0 };

    // Anneaux : le voile est un disque de rayon RING_R - TUBE, double face.
    const rings = w.rings.group;
    for (let i = 0; i < rings.count; i++) {
      readPos(rings, i, p);
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      note('anneau', Math.sqrt(dx * dx + dy * dy + dz * dz) - 5.4);
    }
    // Colonnes de boost : cylindre rayon 3.2, hauteur 19 depuis le sol.
    const pads = w.boosters.mesh;
    for (let i = 0; i < pads.count; i++) {
      readPos(pads, i, p);
      const dx = p.x - cam.x, dz = p.z - cam.z;
      const dy = cam.y - p.y;
      const radial = Math.sqrt(dx * dx + dz * dz) - 3.2;
      const vertical = dy < 0 ? -dy : dy > 19 ? dy - 19 : -0.01;
      note('colonne', Math.max(radial, vertical));
    }
  };
});

/** Attend un nombre d'images RENDUES, pas un temps : a deux images par
 *  seconde, une duree fixe ne donne pas le meme echantillon selon la charge. */
const waitFrames = async (n) => {
  await page.evaluate(
    (target) =>
      new Promise((done) => {
        const rec = window.__perf;
        const start = rec.frames;
        const tick = () => (rec.frames - start >= target ? done() : requestAnimationFrame(tick));
        tick();
      }),
    n,
  );
};

const measure = async (hide, frames) => {
  await page.evaluate((names) => {
    const g = window.__game;
    const all = ['ground', 'blades', 'water', 'clouds', 'city', 'motes', 'boosters', 'rings',
                 'leaves', 'rain'];
    for (const n of all) {
      const m = g.world[n];
      const on = !names.includes(n);
      if (m?.mesh) m.mesh.visible = on;
      if (m?.group) m.group.visible = on;
      if (m?.veil) m.veil.visible = on;
    }
    if (names.includes('post')) {
      g.post.bypass = true;
    }
    window.__perf.ms.length = 0;
    window.__perf.frames = 0;
  }, hide);
  // Chauffe : la premiere image apres un changement de visibilite recompile
  // et fausse la mediane.
  await waitFrames(4);
  await page.evaluate(() => { window.__perf.ms.length = 0; });
  await waitFrames(frames);
  const ms = await page.evaluate(() => window.__perf.ms.slice());
  const sorted = ms.slice().sort((a, b) => a - b);
  return {
    n: ms.length,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    mean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
  };
};

const cases = [
  ['tout', []],
  ['sans eau', ['water']],
  ['sans brins', ['blades']],
  ['sans sol', ['ground']],
  ['sans nuages', ['clouds']],
  ['sans ville', ['city']],
  ['sans pollen', ['motes']],
  ['sans plots+anneaux', ['boosters', 'rings']],
  // Ces deux-la ne coutent rien hors d'OCTOBRE — leur shader de sommet rejette
  // l'instance des la premiere ligne quand la densite est nulle. Les mesurer
  // demande donc WORLD=octobre, sinon on ne mesure que le bruit.
  ['sans feuilles', ['leaves']],
  ['sans pluie', ['rain']],
];

// Le monde a mesurer. Par defaut la plaine, qui est la reference historique de
// ce banc ; `WORLD=octobre` sert a peser les feuilles et la pluie, qui sont
// eteintes partout ailleurs.
const WORLD = process.env.WORLD ?? null;
if (WORLD) {
  await page.evaluate((id) => {
    const w = window.__worlds.find((x) => x.id === id);
    if (w) window.__game.world.setWorld(w, true);
  }, WORLD);
  await waitFrames(8);
  console.log(`monde : ${WORLD}`);
}

await freeze();
const FRAMES = Number(process.env.FRAMES ?? 24);
// Chauffe GLOBALE, jetee. Le tout premier passage paie la compilation des
// shaders et le remplissage des caches : mesure en premier, le cas de
// reference sortait systematiquement plus lent que tous les autres, et chaque
// maillage semblait alors « economiser » un quart de l'image.
await measure([], FRAMES);
const base = await measure([], FRAMES);
const fps = (m) => (m > 0 ? 1000 / m : 0);
console.log(
  `${'tout'.padEnd(20)} ${base.median.toFixed(0).padStart(6)} ms/image ` +
    `= ${fps(base.median).toFixed(1)} i/s   (${base.n} images mesurees)`,
);
for (const [name, hide] of cases.slice(1)) {
  const r = await measure(hide, FRAMES);
  const saved = base.median - r.median;
  console.log(
    `${name.padEnd(20)} ${r.median.toFixed(0).padStart(6)} ms/image ` +
      `= ${fps(r.median).toFixed(1)} i/s   ` +
      `economie ${saved >= 0 ? '+' : ''}${saved.toFixed(0)} ms  ` +
      `(${((saved / base.median) * 100).toFixed(0)} %)`,
  );
}

// --- TEMOIN DE DERIVE. Indispensable pour lire le tableau ci-dessus.
//
// Sous rendu logiciel la machine ne tient pas une cadence stable sur plusieurs
// minutes : elle accelere au fil de la session (caches, frequence). Le cas de
// reference etant mesure EN PREMIER, tout ce qui suit parait economiser — et
// on a vu « sans ville » annoncer 27 %, ce qui est absurde pour une silhouette
// a l'horizon. On remesure donc la reference A LA FIN : l'ecart entre les deux
// est le PLANCHER DE BRUIT du banc, et toute economie du meme ordre doit etre
// tenue pour nulle.
const again = await measure([], FRAMES);
const drift = base.median - again.median;
console.log(
  `\n${'temoin (tout, refait)'.padEnd(20)} ${again.median.toFixed(0).padStart(6)} ms/image   ` +
    `derive ${drift >= 0 ? '+' : ''}${drift.toFixed(0)} ms ` +
    `(${((drift / base.median) * 100).toFixed(0)} %) — toute economie de cet ordre est du bruit`,
);

const near = await page.evaluate(() => window.__perf.near);
console.log('\n--- distance de la camera aux surfaces (scene figee) ---');
for (const [name, s] of Object.entries(near)) {
  console.log(
    `${name.padEnd(12)} au plus pres ${s.min.toFixed(2).padStart(7)} m   ` +
      `${s.inside} image(s) AVEC LA CAMERA DEDANS`,
  );
}
if (logs.length) { console.log('--- erreurs ---'); logs.slice(0, 5).forEach((l) => console.log(' ', l)); }
await browser.close();
