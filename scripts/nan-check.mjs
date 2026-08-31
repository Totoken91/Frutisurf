/**
 * Aucun `normalize()` sur un vecteur qui peut s'annuler.
 *
 * C'ETAIT LE DEFAUT. Pendant dix tours de correction, le joueur a signale des
 * flashs noirs et des « particules noires sur le perso » ; aucun banc d'essai
 * ne les a jamais reproduits, parce qu'ils n'existent pas sous rasteriseur
 * logiciel.
 *
 * Le mecanisme :
 *
 *   vViewW = normalize(cameraPosition - wp.xyz);
 *
 * Ce vecteur s'annule des que la camera atteint la surface — et la camera
 * TRAVERSE reellement les colonnes de boost et les anneaux, puisque le joueur
 * les traverse pour les ramasser et qu'elle le suit une fraction de seconde
 * plus tard (mesure : -0,01 m pour une colonne, -0,98 m pour un anneau).
 * `normalize(vec3(0))` vaut 0/0, c'est-a-dire NaN. Un fragment NaN s'affiche
 * NOIR ; et comme il alimente ensuite le flou de bloom, qui est une moyenne, un
 * seul pixel invalide noircit tout son voisinage. Les deux plaintes — l'objet
 * noir qui bouche la vue et le clignotement plein ecran — etaient le meme bug.
 *
 * Le meme piege existe par PARTICULE dans la gerbe : celles qui frolaient
 * l'objectif sortaient noires pendant que leurs voisines s'affichaient bien.
 * C'est exactement ce que le joueur decrivait.
 *
 * Cette verification est STATIQUE parce que le defaut ne se reproduit pas a
 * l'execution ici. Elle est donc la seule barriere possible, et elle a ete
 * confrontee au code d'avant correction : elle y trouve bien les sites fautifs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})('src');

/**
 * Expressions dont la norme peut valoir zero. On ne cherche pas a analyser le
 * GLSL : on cible les trois formes qui produisent le cas degenere dans ce
 * projet, et on exige `nsafe()` a leur place.
 */
const RISKY = [
  { re: /normalize\(\s*cameraPosition\s*-/, why: 'vecteur de vue : nul quand la camera atteint la surface' },
  { re: /normalize\(\s*uCam\s*-/, why: 'vecteur de vue : nul quand la camera atteint la surface' },
  { re: /normalize\(\s*cross\(/, why: 'produit vectoriel : nul si les deux vecteurs sont colineaires' },
];

const found = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // commentaire
    for (const r of RISKY) {
      if (r.re.test(line)) found.push({ f, n: i + 1, why: r.why, line: line.trim().slice(0, 90) });
    }
  });
}

if (found.length) {
  console.error(
    'normalize() sur un vecteur qui peut s\'annuler — NaN, donc pixels NOIRS,\n' +
      'puis noircissement du voisinage par le flou de bloom.\n' +
      'Utiliser nsafe(v, repli) de GLSL_SAFE.\n',
  );
  for (const b of found) console.error(`  ${b.f}:${b.n}  ${b.line}\n      -> ${b.why}`);
  process.exit(1);
}

// Contre-epreuve : la verification doit voir quelque chose. Si plus personne
// n'utilise nsafe, c'est qu'on l'a perdu en route et que le garde ne garde rien.
const uses = files.filter((f) => /\bnsafe\(/.test(readFileSync(f, 'utf8')));
if (uses.length < 3) {
  console.error(`nsafe() n'est utilise que dans ${uses.length} fichier(s) : le garde a disparu.`);
  process.exit(1);
}

console.log(`OK — aucun normalize() degenere ; nsafe() en place dans ${uses.length} fichiers.`);
