/**
 * Chasseur de PIXELS NOIRS, avec preuve a l'appui.
 *
 * Dix tentatives de correction a l'aveugle, dix echecs. On arrete de
 * raisonner sur le symptome : on l'ATTRAPE.
 *
 * Le monde du jeu est un plein jour intégral — ciel clair, herbe claire,
 * personnage en verre lumineux. Il n'y a, nulle part, de matiere sombre. Donc
 * TOUT pixel vraiment noir est une anomalie, qu'il occupe l'ecran entier ou
 * trois pixels sur le personnage. C'est le meme detecteur pour les deux
 * plaintes.
 *
 * A la detection, on lit le tampon ENTIER et on en fait un PNG. Pas de
 * capture d'ecran du pilote : elle passe par le compositeur, qui peut tres
 * bien avoir deja recouvert l'image fautive. On veut le tampon de dessin
 * lui-meme, tel que le shader l'a laisse.
 */
import { chromium, devices } from 'playwright';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { seedLoadout } from './lib/boot.mjs';

const URL = process.env.URL ?? 'http://localhost:4173/';
const SECONDS = Number(process.env.SECONDS ?? 60);
const W = Number(process.env.W ?? 380);
const H = Number(process.env.H ?? 680);
/** Luminance (0-255) en dessous de laquelle un pixel est declare noir. */
const DARK = Number(process.env.DARK ?? 40);
/** Nombre de pixels sombres a partir duquel on declenche une capture. */
const MIN_PIX = Number(process.env.MIN_PIX ?? 6);
const OUT = 'shots/black';
mkdirSync(OUT, { recursive: true });

// --- Encodeur PNG minimal. Ecrire quarante lignes de zlib coute moins cher
//     qu'une dependance, et surtout ca garantit qu'on regarde EXACTEMENT les
//     octets lus dans le tampon, sans redimensionnement ni recompression.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  // readPixels rend la premiere ligne EN BAS : on retourne a l'ecriture.
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer ?? rgba, src, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// Profil TELEPHONE par defaut : c'est la seule configuration que le joueur
// utilise, et ce n'est pas la meme scene. `detectQuality()` renvoie `low` sur
// mobile, ce qui change les MATERIAUX du personnage (transmission coupee,
// opacite 0,93 au lieu de 1) et la densite du decor. Chasser un artefact en
// profil bureau revenait a inspecter un autre jeu.
const mobile = process.env.DESKTOP !== '1';
const page = await browser.newPage(
  mobile
    ? { ...devices['iPhone 13'], hasTouch: true, isMobile: true, viewport: { width: W, height: H } }
    : { viewport: { width: W, height: H } },
);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
await seedLoadout(page);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

await page.evaluate(([dark, minPix]) => {
  const g = window.__game;
  const gl = g.engine.renderer.getContext();
  const rec = { frames: 0, hits: [], pending: null, worstFrac: 0 };
  window.__hunt = rec;

  // Grille de reconnaissance : bien plus dense qu'un echantillon de quatre
  // points, mais assez legere pour tourner a chaque image. Elle sert
  // uniquement a DECIDER s'il faut payer une lecture complete.
  const GW = 48, GH = 84;
  const scan = new Uint8Array(GW * GH * 4);

  const orig = g.post.render.bind(g.post);
  g.post.render = (dt) => {
    orig(dt);
    rec.frames++;
    if (rec.pending) return; // une capture attend d'etre remontee

    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let n = 0;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const px = new Uint8Array(4);
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x = ((i + 0.5) / GW * w) | 0;
        const y = ((j + 0.5) / GH * h) | 0;
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const l = (px[0] + px[1] + px[2]) / 3;
        if (l < dark) {
          n++;
          if (i < minX) minX = i; if (i > maxX) maxX = i;
          if (j < minY) minY = j; if (j > maxY) maxY = j;
        }
      }
    }
    const frac = n / (GW * GH);
    if (frac > rec.worstFrac) rec.worstFrac = frac;
    if (n < minPix) return;

    // Lecture COMPLETE du tampon : c'est la piece a conviction.
    const full = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, full);
    const c = g.controller;
    rec.pending = {
      w, h,
      data: Array.from(full),
      info: {
        frame: rec.frames,
        sombres: n, sur: GW * GH,
        part: +(frac * 100).toFixed(1),
        // Une tache compacte au centre = quelque chose SUR le personnage.
        // Une tache qui couvre tout = une image noire.
        zone: [minX / GW, minY / GH, maxX / GW, maxY / GH].map((v) => +v.toFixed(2)),
        y: +c.y.toFixed(2), gy: +c.groundY.toFixed(2),
        air: c.airborne, planing: c.planing, sunk: c.sunk,
        boost: c.boosting, flash: +g.state.popFlash.toFixed(2),
        speed: +c.speed.toFixed(1),
      },
    };
  };
}, [DARK, MIN_PIX]);

console.log(`profil ${mobile ? 'TELEPHONE' : 'bureau'}   seuil noir ${DARK}/255   declenche a ${MIN_PIX} pixels`);
const end = Date.now() + SECONDS * 1000;
let i = 0, saved = 0;
const found = [];
while (Date.now() < end && saved < 8) {
  if (mobile) {
    // Un doigt : il dirige en glissant et arme le saut par sa duree d'appui.
    const x = i % 2 ? W * 0.30 : W * 0.70;
    await page.touchscreen.tap(W * 0.5, H * 0.6);
    await page.waitForTimeout(160);
    await page.mouse.move(W * 0.5, H * 0.6);
    await page.mouse.down();
    await page.mouse.move(x, H * 0.6, { steps: 6 });
    await page.waitForTimeout(420);
    await page.mouse.up();
    await page.waitForTimeout(220);
  } else {
    const k = ['ArrowRight', 'ArrowLeft'][i % 2];
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down(k);
    await page.waitForTimeout(380);
    await page.keyboard.down('Space');
    await page.waitForTimeout(280);
    await page.keyboard.up('Space');
    await page.keyboard.up(k);
    await page.waitForTimeout(200);
  }
  i++;

  const hit = await page.evaluate(() => {
    const r = window.__hunt;
    if (!r.pending) return null;
    const p = r.pending;
    r.pending = null;
    return p;
  });
  if (hit) {
    const name = `${OUT}/noir-${String(++saved).padStart(2, '0')}.png`;
    writeFileSync(name, png(Uint8Array.from(hit.data), hit.w, hit.h));
    found.push({ name, ...hit.info });
    console.log(`${name}  ${JSON.stringify(hit.info)}`);
  }
}

const stat = await page.evaluate(() => ({ frames: window.__hunt.frames, worst: window.__hunt.worstFrac }));
console.log(
  `\n${stat.frames} images jouees, ${saved} capture(s), ` +
    `pire proportion de pixels sombres ${(stat.worst * 100).toFixed(1)} %`,
);
if (!saved) console.log('AUCUN pixel noir trouve sur toute la session.');
if (logs.length) { console.log('--- erreurs ---'); logs.slice(0, 5).forEach((l) => console.log(' ', l)); }
await browser.close();
