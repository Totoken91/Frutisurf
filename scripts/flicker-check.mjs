/**
 * Detecteur de frames noires.
 *
 * On ne peut pas voir un flash d'une frame sur une capture d'ecran : il faut
 * lire le framebuffer A CHAQUE frame. On echantillonne quatre pixels et on
 * retient la luminance maximale : si le MAXIMUM est proche de zero, toute
 * l'image etait noire.
 *
 * DEUX sondes, et la distinction est tout l'interet du fichier :
 *
 *  - `noires`  lit juste APRES le rendu. Elle repond a « le jeu a-t-il dessine
 *              une image noire ? ».
 *  - `presentees` lit en FIN DE TICK, apres tous les autres rAF. Elle repond a
 *              « le compositeur va-t-il afficher une image noire ? », ce qui
 *              n'est pas la meme question : n'importe quel rAF inscrit apres la
 *              boucle de jeu peut reallouer le tampon de dessin une fois le
 *              rendu termine. Un tampon realloue est noir, et la sonde d'apres
 *              rendu ne peut structurellement pas le voir.
 *
 * C'est exactement ce qui se passait quand un evenement `resize` programmait sa
 * propre frame : le jeu rendait, puis setSize reallouait, et l'image presentee
 * etait noire alors que l'image RENDUE etait parfaite.
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
  const rec = { frames: 0, black: [], dark: 0, nan: 0, tail: 0, tailFrames: 0 };
  window.__flick = rec;

  // On date le dernier redimensionnement effectif : une image noire qui tombe
  // sur la frame d'un redimensionnement et une image noire isolee n'ont pas la
  // meme cause, et sans ce marqueur on ne peut pas les distinguer.
  let lastResizeFrame = -999;
  let resizes = 0;
  const flush = g.engine.flushResize.bind(g.engine);
  g.engine.flushResize = () => {
    const before = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    flush();
    if (gl.drawingBufferWidth !== before[0] || gl.drawingBufferHeight !== before[1]) {
      lastResizeFrame = rec.frames;
      resizes++;
    }
  };
  rec.info = () => ({ lastResizeFrame, resizes });

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
          sunk: c.sunk, planing: c.planing,
          buf: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          css: [innerWidth, innerHeight],
          sinceResize: rec.frames - lastResizeFrame,
          ctx: gl.isContextLost(),
          quality: g.engine.quality,
          center: [+g.post.surf.uniforms.get('uCenter').value.x.toFixed(3),
                   +g.post.surf.uniforms.get('uCenter').value.y.toFixed(3)],
        });
      }
    }
    const c = g.controller;
    if (!Number.isFinite(c.x + c.y + c.z + c.speed)) rec.nan++;
  };

  // Sonde de FIN DE TICK. Elle se reprogramme depuis sa propre execution, donc
  // apres la boucle de jeu (qui se reprogramme, elle, en tete de la sienne) :
  // elle passe en dernier et lit le tampon tel qu'il sera presente.
  const tail = () => {
    requestAnimationFrame(tail);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let max = 0;
    for (const [fx, fy] of [[0.5, 0.25], [0.25, 0.6], [0.75, 0.6], [0.5, 0.9]]) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = px[0] + px[1] + px[2];
      if (l > max) max = l;
    }
    rec.tailFrames++;
    if (max < 24) {
      rec.tail++;
      if (!rec.tailInfo) rec.tailInfo = [];
      if (rec.tailInfo.length < 8) {
        rec.tailInfo.push({
          f: rec.frames, buf: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          sinceResize: rec.frames - lastResizeFrame,
        });
      }
    }
  };
  requestAnimationFrame(tail);
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
    if (RESIZE) {
      // La barre d'adresse mobile ne bouge pas une fois par minute : elle
      // oscille. Il faut la MEME densite pour rejouer la course entre le
      // redimensionnement et le rendu, qui ne se perd qu'une fois sur quelques
      // centaines de frames quand on la sollicite mollement.
      for (let k = 0; k < 6; k++) {
        await page.setViewportSize({ width: 360, height: 640 - 56 });
        await page.waitForTimeout(40);
        await page.setViewportSize({ width: 360, height: 640 });
        await page.waitForTimeout(40);
      }
    }
    i++;
  }
  await page.keyboard.up('ShiftLeft');
};
await drive();

const r = await page.evaluate(() => window.__flick);
console.log(
  `frames=${r.frames}  noires=${r.dark}  ` +
    `presentees=${r.tail}/${r.tailFrames}  nan=${r.nan}`,
);
for (const b of r.black.slice(0, 12)) console.log('  RENDU  ', JSON.stringify(b));
for (const b of (r.tailInfo ?? [])) console.log('  PRESENT', JSON.stringify(b));
if (logs.length) { console.log('--- erreurs console ---'); logs.slice(0, 8).forEach((l) => console.log(' ', l)); }
await browser.close();
process.exitCode = r.dark > 0 || r.tail > 0 || r.nan > 0 ? 1 : 0;
