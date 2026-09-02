/**
 * L'INVARIANT DU DECOR ANCRE AU MONDE, verifie sur le code lui-meme.
 *
 * Le quartier d'octobre est un semis de rangees qui suit le joueur : quand il
 * franchit un pas de grille, l'ancre recule d'un cran et chaque instance herite
 * du z de sa voisine. C'est ce qui fait defiler un decor infini sans jamais en
 * allouer un seul — et c'est aussi le piege.
 *
 *   LE CONTENU D'UNE RANGEE NE DOIT DEPENDRE QUE DE SON Z, JAMAIS DE SON INDEX.
 *
 * Sinon le contenu ne suit pas le z, et tout le quartier change de place a la
 * fois. C'est arrive : le cote du lampadaire se lisait sur mod(row, 2), donc
 * tous les mats, leurs halos et leurs flaques sautaient d'un bord a l'autre de
 * la route toutes les vingt metres — deux fois par seconde en croisiere.
 *
 * ---
 *
 * POURQUOI CE BANC EST STATIQUE ET NON VISUEL.
 *
 * Le premier jet mesurait l'image : on avancait le joueur par pas de deux
 * metres et on comparait l'ecart image a image aux franchissements de grille et
 * ailleurs. Ca ne marche pas, et l'echec est instructif — un lampadaire a
 * l'horizon fait trois pixels. Meme en flippant TOUS les mats d'un bord a
 * l'autre, l'ecart aux franchissements sortait a 1,08 fois celui des autres
 * pas : parfaitement noye dans les huit pour cent de parallaxe que deux metres
 * d'avance produisent de toute facon. Un banc qui ne tombe pas sur le defaut
 * qu'il est ecrit pour attraper est pire qu'aucun banc.
 *
 * L'invariant, lui, est STRUCTUREL : il porte sur ce dont une fonction a le
 * droit de dependre. On le verifie donc la ou il vit, dans la signature et le
 * corps des fonctions de placement — c'est exact, instantane, et ca ne peut pas
 * flotter avec la charge de la machine.
 */
import { TOWN_GLSL, TOWN_VERTEX } from '../src/world/Town';

let bad = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'}  ${name.padEnd(52)} ${detail}`);
};

/** Corps d'une fonction GLSL, accolades comprises. */
function body(src: string, name: string): string {
  const at = src.indexOf(`${name}(`);
  if (at < 0) return '';
  let i = src.indexOf('{', at);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}

/** Signature d'une fonction GLSL, parametres seuls. */
function params(src: string, name: string): string {
  const at = src.indexOf(`${name}(`);
  if (at < 0) return '';
  return src.slice(at + name.length + 1, src.indexOf(')', at));
}

// --- 1. LES FONCTIONS DE CONTENU NE PRENNENT PAS DE RANGEE.
//
//     C'est la garantie la plus forte du lot : ce dont une fonction ne peut pas
//     parler, elle ne peut pas en dependre. `lampAt` et `townSide` ne recoivent
//     que des positions monde, donc l'index d'instance n'a aucun chemin vers
//     elles.
for (const fn of ['lampAt', 'townSide']) {
  const p = params(TOWN_GLSL, fn);
  check(`${fn} ne recoit pas d index de rangee`, !!p && !/\brow\b/.test(p), `(${p})`);
  const b = body(TOWN_GLSL, fn);
  check(`${fn} ne mentionne ni rangee ni origine`, !!b && !/\brow\b|\borg\b|uOrigin/.test(b));
}

// --- 2. UNE SEULE FONCTION A LE DROIT DE CONNAITRE LA RANGEE : celle qui la
//     convertit en z. C'est le point de passage unique entre l'index et le
//     monde, et le limiter a une fonction rend la faute impossible a semer
//     ailleurs.
const rowFns = [...TOWN_GLSL.matchAll(/(?:vec2|float|vec3)\s+(\w+)\s*\(([^)]*)\)/g)]
  .filter((m) => /\brow\b/.test(m[2]))
  .map((m) => m[1]);
check('une seule fonction convertit une rangee en monde',
  rowFns.length === 2 && rowFns.includes('townZ') && rowFns.includes('lampXZ'),
  rowFns.join(', '));
// `lampXZ` est le raccourci du sol : il compose les deux, il ne calcule rien.
check('lampXZ ne fait que composer townZ et lampAt',
  /return\s+lampAt\s*\(\s*townZ\s*\(\s*row\s*,\s*org\s*\)\s*\)\s*;/.test(body(TOWN_GLSL, 'lampXZ')));

// --- 3. LE SHADER DU DECOR NE TIRE DE L'INSTANCE QUE SA RANGEE ET SON ROLE.
//
//     Tout le reste — cote de la route, taille, orientation, existence — doit
//     se lire dans le z. Le premier jet portait le cote dans iSpec.y, et c'est
//     exactement ce qui a fait sauter le quartier.
const used = [...new Set([...TOWN_VERTEX.matchAll(/iSpec\.([xyzw])/g)].map((m) => m[1]))].sort();
check('le shader ne lit que la rangee et le role dans l instance',
  used.length === 2 && used[0] === 'x' && used[1] === 'y', `iSpec.${used.join(', iSpec.')}`);
check('le cote de la route se lit dans le monde',
  /townSide\s*\(\s*z\s*,/.test(TOWN_VERTEX) && !/side\s*=\s*iSpec/.test(TOWN_VERTEX));

console.log(bad ? `\n${bad} echec(s).` : '\nOK — le contenu d une rangee ne depend que de sa position monde.');
process.exitCode = bad ? 1 : 0;
