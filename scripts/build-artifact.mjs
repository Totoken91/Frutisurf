/**
 * Assemble le bundle autonome en UNE page, prete a etre publiee.
 *
 * La page n'a volontairement aucun mobilier : le jeu occupe tout l'ecran,
 * conformement au retrait complet de l'interface. Elle s'assume aussi en
 * theme unique — le monde du jeu est un plein jour Frutiger Aero fixe, il ne
 * doit pas repondre au mode sombre du lecteur — donc le fond est peint
 * explicitement plutot que laisse transparent.
 *
 * ---
 *
 * LE CORPS EST EXTRAIT DE `index.html`, IL N'EST PAS RECOPIE.
 *
 * Il l'etait, et ca a coute la version publiee. La coquille portait un
 * `<canvas id="stage">` et un `<div id="hud">` ecrits a la main ; le jour ou
 * l'ecran d'equipement a ajoute un `<div id="pick">` a `index.html`, la
 * coquille ne l'a pas suivi. Le jeu se lancait, `Select` cherchait son noeud,
 * ne le trouvait pas, et le module mourait sur un
 * `Cannot set properties of null` AVANT la premiere image. Resultat : un aplat
 * cyan avec le HUD dessus, fige. Le developpement en `npm run dev` et toute la
 * suite de verifications tournaient sur `index.html` et n'ont rien vu.
 *
 * Le commentaire juste en dessous disait deja, a propos du CSS, que « la
 * dupliquer ici la ferait deriver au premier ajustement ». C'etait vrai du
 * style et tout aussi vrai du corps ; je ne l'ai applique qu'a la moitie du
 * probleme.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const bundle = readFileSync('dist-single/bundle.js', 'utf8');

/**
 * Le corps de `index.html`, sans son script de module — celui-ci est remplace
 * par le bundle inline. Tout element ajoute a la page de developpement se
 * retrouve donc automatiquement dans l'artefact.
 */
function bodyFromIndex() {
  const index = readFileSync('index.html', 'utf8');
  const m = index.match(/<body>([\s\S]*?)<\/body>/);
  if (!m) throw new Error("index.html : aucun <body> trouve.");
  const body = m[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
  // Deux garde-fous : le canvas est indispensable, et il ne doit rester aucun
  // script — un script oublie ici chargerait un module qui n'existe pas dans
  // l'artefact, et on repartirait pour une page morte.
  if (!body.includes('id="stage"')) throw new Error('index.html : <canvas id="stage"> introuvable.');
  if (/<script/i.test(body)) throw new Error('build-artifact : un <script> a survecu au nettoyage du corps.');
  return body;
}
// La feuille du jeu est inlinee telle quelle : elle porte le reset plein ecran
// ET les deux jauges. La dupliquer ici la ferait deriver au premier ajustement.
const css = readFileSync('src/style.css', 'utf8');
const out = process.argv[2] ?? 'dist-single/artifact.html';

if (bundle.includes('</script')) {
  throw new Error('Le bundle contient une sequence </script : il faut l\'echapper.');
}

const html = `<title>Frutiger Surfer</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;800&display=swap" rel="stylesheet" />
<style>
/* Theme unique assume : le jeu est un plein jour fixe, il ne doit pas repondre
   au mode sombre du lecteur. Le fond est donc peint explicitement. */
:root { color-scheme: light; }
${css}
</style>
${bodyFromIndex()}
<script>
${bundle}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} kB`);
