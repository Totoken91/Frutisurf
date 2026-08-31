/**
 * Detecteur de SCINTILLEMENT temporel, camera immobile.
 *
 * Un clignotement peut avoir deux origines completement differentes :
 *
 *  - la CAMERA bouge d'une image a l'autre, et tout le cadre vibre ;
 *  - la camera ne bouge pas, mais des SHADERS animes (paillettes de l'eau,
 *    ombres de nuages, rafales, pollen) changent trop vite d'une image a
 *    l'autre — un speculaire tres dur sur une normale bruitee s'allume et
 *    s'eteint pixel par pixel, ce que l'oeil lit comme du grésillement.
 *
 * On ne peut pas les distinguer en jouant : les deux sont presents en meme
 * temps. On FIGE donc la camera et le surfeur, on laisse seulement le temps
 * avancer, et on mesure la variation image par image. Ce qui reste est
 * forcement temporel.
 *
 * On mesure deux choses, et la distinction compte :
 *  - la moyenne du cadre : un scintillement GLOBAL, celui qu'on voit ;
 *  - la proportion de sondes qui bougent beaucoup : un scintillement LOCAL,
 *    du grain qui grouille sans changer la luminosite d'ensemble.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const FRAMES = Number(process.env.FRAMES ?? 120);
/** Cacher un maillage pour l'accuser ou le disculper : water, blades, motes, clouds. */
const HIDE = process.env.HIDE ?? '';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 320, height: 560 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const out = await page.evaluate(
  async ([frames, hide]) => {
    const g = window.__game;
    const gl = g.engine.renderer.getContext();

    // --- On fige tout ce qui n'est pas le TEMPS.
    const c = g.controller;
    // Place le surfeur au-dessus d'une nappe d'eau : c'est la que se trouve le
    // speculaire le plus dur du jeu, donc le pire cas de scintillement.
    for (let i = 0; i < 40000 && !c.onWater; i++) {
      c.z -= 0.5;
      c.speed = 40;
      c.step(1 / 120, { steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false });
    }
    g.run.timeLeft = 9999;
    const frozen = { x: c.x, y: c.y, z: c.z, speed: c.speed };
    // On neutralise la simulation ET la camera : seul `time` continue d'avancer.
    c.step = () => {
      c.x = frozen.x; c.y = frozen.y; c.z = frozen.z; c.speed = frozen.speed;
    };
    g.rig.update = () => {};

    for (const name of hide ? hide.split(',') : []) {
      const m = g.world[name];
      if (m?.mesh) m.mesh.visible = false;
      else if (m?.group) m.group.visible = false;
    }

    // --- Mesure. Grille dense : le scintillement local ne se voit pas sur
    //     quatre points.
    const taps = [];
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) taps.push([(i + 0.5) / 8, (j + 0.5) / 8]);
    const px = new Uint8Array(4);
    const samples = [];

    await new Promise((done) => {
      const orig = g.post.render.bind(g.post);
      let n = 0;
      g.post.render = (dt) => {
        orig(dt);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const row = [];
        for (const [fx, fy] of taps) {
          gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          row.push((px[0] + px[1] + px[2]) / 3);
        }
        samples.push(row);
        if (++n >= frames) { g.post.render = orig; done(); }
      };
    });

    // Ecart image a image : moyenne du cadre, et proportion de sondes agitees.
    let meanJump = 0, worstJump = 0, localSum = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      const j = Math.abs(mb - ma);
      meanJump += j;
      if (j > worstJump) worstJump = j;
      let agitated = 0;
      for (let k = 0; k < a.length; k++) if (Math.abs(b[k] - a[k]) > 12) agitated++;
      localSum += agitated / a.length;
    }
    const n = samples.length - 1;
    return {
      frames: samples.length,
      global: +(meanJump / n).toFixed(2),
      worst: +worstJump.toFixed(2),
      local: +((localSum / n) * 100).toFixed(1),
      onWater: c.onWater,
    };
  },
  [FRAMES, HIDE],
);

console.log(
  `${(HIDE ? `sans ${HIDE}` : 'tout visible').padEnd(22)} ` +
    `global ${String(out.global).padStart(6)} /255 par image (pire ${out.worst})   ` +
    `local ${String(out.local).padStart(5)} % de sondes agitees   ` +
    `[${out.frames} images, eau=${out.onWater}]`,
);
if (logs.length) { console.log('--- erreurs ---'); logs.slice(0, 4).forEach((l) => console.log(' ', l)); }
await browser.close();
