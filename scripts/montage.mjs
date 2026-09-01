/**
 * Colle plusieurs captures cote a cote, en une image.
 *
 * Quatre mondes se jugent ENSEMBLE, pas l'un apres l'autre : la seule question
 * qui vaille est de savoir si on les distingue d'un coup d'oeil, et on ne peut
 * y repondre qu'en les voyant sur la meme ligne. Le montage passe par une page
 * HTML et une capture Playwright plutot que par une bibliotheque d'images :
 * aucune dependance de plus, et la mise en page se regle en CSS.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const out = process.argv[2];
const files = process.argv.slice(3);
if (!out || !files.length) {
  console.error('usage : node scripts/montage.mjs sortie.png a.png b.png ...');
  process.exit(1);
}

const cards = files
  .map((f) => {
    const b64 = readFileSync(f).toString('base64');
    const label = basename(f).replace(/^\d+-/, '').replace(/\.png$/, '').toUpperCase();
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${label}</figcaption></figure>`;
  })
  .join('');

const html = `<!doctype html><meta charset="utf8"><style>
  body { margin: 0; background: #0a2740; display: flex; gap: 10px; padding: 10px;
         font: 700 15px Inter, system-ui, sans-serif; }
  figure { margin: 0; position: relative; }
  img { display: block; width: 300px; border-radius: 8px; }
  figcaption { position: absolute; left: 10px; bottom: 10px; color: #fff;
               letter-spacing: 0.16em; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
</style>${cards}`;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
// La fenetre est taillee sur le CONTENU : `body` est un conteneur flex, il
// remplit la fenetre quelle qu'elle soit, et decouper sur sa boite laissait
// une bande noire a droite.
const page = await browser.newPage({ viewport: { width: files.length * 310 + 10, height: 900 } });
await page.setContent(html);
const box = await page.locator('figure').first().boundingBox();
await page.screenshot({
  path: out,
  clip: { x: 0, y: 0, width: files.length * 310 + 10, height: Math.ceil(box.height) + 20 },
});
console.log('->', out);
await browser.close();
