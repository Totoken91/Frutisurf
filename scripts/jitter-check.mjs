/**
 * Detecteur de SAUTS : d'image (clignotement) et de camera (a-coups).
 *
 * Les deux se plaignent de la meme facon — « ca clignote », « ca saute » — et
 * ne se voient sur aucune capture, parce que ce sont des ECARTS ENTRE DEUX
 * IMAGES CONSECUTIVES et non des etats. On mesure donc des derivees :
 *
 *  - luminance moyenne du cadre, image par image. Un clignotement, c'est un
 *    saut de luminance ; sa cause se lit dans ce qui saute EN MEME TEMPS ;
 *  - position et direction de la camera, image par image, normalisees par le
 *    temps ecoule : un a-coup, c'est une vitesse qui explose sur une image.
 *
 * Chaque saut est date par rapport au dernier clic, ce qui repond directement a
 * « la camera bouge brutalement quand on clique ».
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const SECONDS = Number(process.env.SECONDS ?? 45);
const MODE = process.env.MODE ?? 'click'; // click | key | idle

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 860 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const g = window.__game;
  const gl = g.engine.renderer.getContext();
  const px = new Uint8Array(4);
  const rec = { frames: 0, lum: [], cam: [], lastClick: -1e9 };
  window.__jit = rec;
  window.__mark = () => { rec.lastClick = performance.now(); };

  // Grille de 4x4 : la moyenne d'une grille suit la luminance du CADRE, la ou
  // quatre points isoles suivraient surtout ce qui passe devant eux.
  const taps = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) taps.push([(i + 0.5) / 4, (j + 0.5) / 4]);

  let prevLum = -1;
  let prevPos = null;
  let prevDir = null;
  let prevFov = -1;
  let prevT = -1;

  const orig = g.post.render.bind(g.post);
  g.post.render = (dt) => {
    orig(dt);
    const now = performance.now();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let sum = 0;
    for (const [fx, fy] of taps) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sum += (px[0] + px[1] + px[2]) / 3;
    }
    const lum = sum / taps.length;
    rec.frames++;

    const cam = g.engine.camera;
    const pos = cam.position.clone();
    const dir = new (pos.constructor)(0, 0, -1).applyQuaternion(cam.quaternion);
    const dtReal = prevT < 0 ? 0.016 : Math.max(0.001, (now - prevT) / 1000);

    if (prevLum >= 0) {
      // Ecart RELATIF : sauter de 20 a 30 se voit, de 200 a 210 non.
      const jump = Math.abs(lum - prevLum) / Math.max(8, prevLum);
      if (jump > 0.06 && rec.lum.length < 40) {
        rec.lum.push({
          f: rec.frames, from: +prevLum.toFixed(1), to: +lum.toFixed(1),
          pct: +(jump * 100).toFixed(1),
          dt: +(dtReal * 1000).toFixed(0),
          sinceClick: +(now - rec.lastClick).toFixed(0),
          air: g.controller.airborne, planing: g.controller.planing,
          boost: g.controller.boosting, flash: +g.state.popFlash.toFixed(2),
          fov: +cam.fov.toFixed(1), q: g.engine.quality,
        });
      }
    }

    if (prevPos) {
      // Vitesse de la camera (m/s) et vitesse angulaire (degres/s). Normaliser
      // par dt est indispensable : sans ca une image longue ressemble a un
      // a-coup alors que le mouvement etait parfaitement continu.
      const v = pos.distanceTo(prevPos) / dtReal;
      const ang = (Math.acos(Math.min(1, Math.max(-1, dir.dot(prevDir)))) * 180) / Math.PI / dtReal;
      const dFov = Math.abs(cam.fov - prevFov) / dtReal;
      if ((v > 26 || ang > 150 || dFov > 90) && rec.cam.length < 40) {
        rec.cam.push({
          f: rec.frames,
          v: +v.toFixed(1), ang: +ang.toFixed(0), dFov: +dFov.toFixed(0),
          dt: +(dtReal * 1000).toFixed(0),
          sinceClick: +(now - rec.lastClick).toFixed(0),
          y: +pos.y.toFixed(2), py: +g.controller.y.toFixed(2),
          gy: +g.controller.groundY.toFixed(2),
          air: g.controller.airborne,
          phase: g.run.phase,
        });
      }
    }

    prevLum = lum; prevPos = pos; prevDir = dir; prevFov = cam.fov; prevT = now;
  };
});

const end = Date.now() + SECONDS * 1000;
let i = 0;
while (Date.now() < end) {
  await page.keyboard.down(['ArrowRight', 'ArrowLeft'][i % 2]);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__mark());
  if (MODE === 'click') {
    await page.mouse.click(240, 430);
  } else if (MODE === 'key') {
    await page.keyboard.down('Space');
    await page.waitForTimeout(260);
    await page.keyboard.up('Space');
  }
  await page.waitForTimeout(500);
  await page.keyboard.up(['ArrowRight', 'ArrowLeft'][i % 2]);
  await page.waitForTimeout(240);
  i++;
}

const r = await page.evaluate(() => window.__jit);
console.log(`mode=${MODE}  frames=${r.frames}  sauts de luminance=${r.lum.length}  a-coups camera=${r.cam.length}`);
for (const b of r.lum.slice(0, 14)) console.log('  LUM ', JSON.stringify(b));
for (const b of r.cam.slice(0, 14)) console.log('  CAM ', JSON.stringify(b));
if (logs.length) { console.log('--- erreurs console ---'); logs.slice(0, 6).forEach((l) => console.log(' ', l)); }
await browser.close();
