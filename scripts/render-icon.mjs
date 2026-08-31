/**
 * Rend public/icon.svg en PNG 180x180 (apple-touch-icon).
 *
 * Safari ignore les icones SVG pour l'ecran d'accueil : sans ce PNG, un jeu
 * ajoute depuis un iPhone recoit une capture de la page en guise d'icone.
 * Playwright est deja une dependance du projet, autant s'en servir plutot que
 * d'ajouter un encodeur d'images.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
const size = Number(process.argv[2] ?? 180);
const out = process.argv[3] ?? 'public/apple-touch-icon.png';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: size, height: size } });
await page.setContent(
  `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
);
await page.locator('svg').screenshot({ path: out });
await browser.close();
console.log('icone ->', out, `${size}x${size}`);
