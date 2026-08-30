/**
 * Chasse a la frame noire, version serieuse.
 *
 * La sonde precedente tournait sur le profil DESKTOP, quelques centaines de
 * frames, sans jamais reproduire. Trois defauts corriges ici :
 *
 *  1. On se fait passer pour un iPhone : `detectQuality()` renvoie alors
 *     'low', et c'est un tout autre pipeline (pas de SMAA, bloom en noyau
 *     moyen, atlas de nuages en 512). Tester le desktop ne disait rien du
 *     telephone du joueur.
 *  2. Fenetre minuscule pour que le rendu logiciel monte en cadence : quelques
 *     milliers de frames au lieu de deux cents.
 *  3. On AGRESSE : rafales de redimensionnement, passage en arriere-plan,
 *     changement d'orientation, et perte de contexte WebGL provoquee.
 *
 * On enregistre aussi les frames simplement SOMBRES (sous 45 % de la mediane
 * glissante) : un flash percu comme noir n'est pas forcement noir absolu.
 */
import { chromium, devices } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const SECONDS = Number(process.env.SECONDS ?? 150);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  hasTouch: true,
  isMobile: true,
  viewport: { width: 180, height: 320 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const g = window.__game;
  const gl = g.engine.renderer.getContext();
  const px = new Uint8Array(4);
  const rec = {
    frames: 0, black: 0, dark: 0, samples: [], quality: g.engine.quality,
    lost: 0, restored: 0,
  };
  window.__flick = rec;
  g.engine.renderer.domElement.addEventListener('webglcontextlost', () => rec.lost++);
  g.engine.renderer.domElement.addEventListener('webglcontextrestored', () => rec.restored++);

  let median = 400;
  const orig = g.post.render.bind(g.post);
  g.post.render = (dt) => {
    orig(dt);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let max = 0;
    for (const [fx, fy] of [[0.5, 0.18], [0.2, 0.55], [0.8, 0.55], [0.5, 0.88], [0.5, 0.42]]) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = px[0] + px[1] + px[2];
      if (l > max) max = l;
    }
    rec.frames++;
    median = median * 0.98 + max * 0.02;
    const isBlack = max < 24;
    const isDark = max < median * 0.45;
    if (isBlack) rec.black++;
    if (isDark) rec.dark++;
    if ((isBlack || isDark) && rec.samples.length < 30) {
      const c = g.controller, cam = g.engine.camera;
      rec.samples.push({
        f: rec.frames, max, med: Math.round(median), t: +g.time.toFixed(2),
        cam: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],
        fov: +cam.fov.toFixed(1),
        z: +c.z.toFixed(0), y: +c.y.toFixed(2), air: c.airborne, spd: +c.speed.toFixed(1),
        buf: [w, h], dpr: g.engine.renderer.getPixelRatio(),
        phase: g.run.phase,
      });
    }
  };
});

const t0 = Date.now();
let i = 0;
await page.keyboard.down('ShiftLeft').catch(() => {});
while (Date.now() - t0 < SECONDS * 1000) {
  // Jeu au doigt, comme sur telephone.
  await page.touchscreen.tap(90, 220).catch(() => {});
  await page.waitForTimeout(300);
  i++;
  if (i % 5 === 0) {
    // Barre d'adresse qui se retracte.
    await page.setViewportSize({ width: 180, height: 292 });
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 180, height: 320 });
  }
  if (i % 11 === 0) {
    // Orientation.
    await page.setViewportSize({ width: 320, height: 180 });
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 180, height: 320 });
  }
  if (i % 17 === 0) {
    // Passage en arriere-plan puis retour : le pas de temps fait un bond.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  if (i === 40) {
    // Perte de contexte provoquee : verifie la reprise.
    await page.evaluate(() => {
      const gl = window.__game.engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) { ext.loseContext(); setTimeout(() => ext.restoreContext(), 500); }
    });
    await page.waitForTimeout(1500);
  }
}

const r = await page.evaluate(() => window.__flick);
console.log(`qualite=${r.quality}  frames=${r.frames}  noires=${r.black}  sombres=${r.dark}  contexte perdu/rendu=${r.lost}/${r.restored}`);
for (const s of r.samples.slice(0, 20)) console.log(' ', JSON.stringify(s));
if (logs.length) { console.log('--- erreurs console ---'); logs.slice(0, 10).forEach((l) => console.log(' ', l)); }
await browser.close();
process.exitCode = r.black > 0 ? 1 : 0;
