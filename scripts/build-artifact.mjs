/**
 * Assemble le bundle autonome en UNE page, prete a etre publiee.
 *
 * La page n'a volontairement aucun mobilier : le jeu occupe tout l'ecran,
 * conformement au retrait complet de l'interface. Elle s'assume aussi en
 * theme unique — le monde du jeu est un plein jour Frutiger Aero fixe, il ne
 * doit pas repondre au mode sombre du lecteur — donc le fond est peint
 * explicitement plutot que laisse transparent.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const bundle = readFileSync('dist-single/bundle.js', 'utf8');
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
<canvas id="stage"></canvas>
<div id="hud"></div>
<script>
${bundle}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} kB`);
