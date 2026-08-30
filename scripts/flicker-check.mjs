/**
 * Detecteur de frames noires.
 *
 * On ne peut pas voir un flash d'une frame sur une capture d'ecran : il faut
 * lire le framebuffer A CHAQUE frame, juste apres le rendu. On echantillonne
 * une grille de 5x5 pixels et on retient la luminance maximale de la frame :
 * si le MAXIMUM est proche de zero, toute l'image etait noire.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const SECONDS = Number(process.env.SECONDS ?? 70);
const RESIZE = process.env.RESIZE === '1';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });

await page.evaluate(() => {
  const g = window.__game;
  const gl = g.engine.renderer.getContext();
  const px = new Uint8Array(4);
  const rec = { frames: 0, black: [], dark: 0, nan: 0 };
  window.__flick = rec;
  const orig = g.post.render.bind(g.post);
  g.post.render = (dt) => {
    orig(dt);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let max = 0;
    for (const [fx, fy] of [[0.5, 0.25], [0.25, 0.6], [0.75, 0.6], [0.5, 0.9]]) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = px[0] + px[1] + px[2];
      if (l > max) max = l;
    }
    rec.frames++;
    if (max < 24) {
      rec.dark++;
      if (rec.black.length < 24) {
        const c = g.controller;
        rec.black.push({
          f: rec.frames, max,
          t: +g.time.toFixed(2), z: +c.z.toFixed(1), y: +c.y.toFixed(2),
          air: c.airborne, spd: +c.speed.toFixed(1),
          camy: +g.engine.camera.position.y.toFixed(2),
          fov: +g.engine.camera.fov.toFixed(1),
          center: [+g.post.surf.uniforms.get('uCenter').value.x.toFixed(3),
                   +g.post.surf.uniforms.get('uCenter').value.y.toFixed(3)],
        });
      }
    }
    const c = g.controller;
    if (!Number.isFinite(c.x + c.y + c.z + c.speed)) rec.nan++;
  };
});

// Pilotage : on joue vraiment, sinon on ne declenche rien.
const drive = async () => {
  const end = Date.now() + SECONDS * 1000;
  await page.keyboard.down('ShiftLeft');
  let i = 0;
  while (Date.now() < end) {
    const k = ['ArrowRight', 'ArrowLeft'][i % 2];
    await page.keyboard.down(k);
    await page.waitForTimeout(420);
    await page.keyboard.down('Space');
    await page.waitForTimeout(320);
    await page.keyboard.up('Space');
    await page.keyboard.up(k);
    await page.waitForTimeout(260);
    // Tempete de redimensionnement : sur telephone la barre d'adresse qui se
    // retracte declenche exactement ca, plusieurs fois par session.
    if (RESIZE && i % 2 === 1) {
      await page.setViewportSize({ width: 360, height: 640 - 56 });
      await page.waitForTimeout(120);
      await page.setViewportSize({ width: 360, height: 640 });
    }
    i++;
  }
  await page.keyboard.up('ShiftLeft');
};
await drive();

const r = await page.evaluate(() => window.__flick);
console.log(`frames=${r.frames}  noires=${r.dark}  nan=${r.nan}`);
for (const b of r.black.slice(0, 12)) console.log(' ', JSON.stringify(b));
if (logs.length) { console.log('--- erreurs console ---'); logs.slice(0, 8).forEach((l) => console.log(' ', l)); }
await browser.close();
process.exitCode = r.dark > 0 || r.nan > 0 ? 1 : 0;
