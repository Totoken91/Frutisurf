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
const out = process.argv[2] ?? 'dist-single/artifact.html';

if (bundle.includes('</script')) {
  throw new Error('Le bundle contient une sequence </script : il faut l\'echapper.');
}

const html = `<title>Frutiger Surfer</title>
<style>
  /* Theme unique assume : le jeu est un plein jour fixe. Le fond est le cyan
     du ciel, pour qu'aucun liseré blanc n'apparaisse avant le premier rendu
     ni autour du canvas sur un ecran d'un autre rapport. */
  :root { color-scheme: light; }
  html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: #15cee8;
    overscroll-behavior: none;
    touch-action: none;
  }
  #stage {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
  }
</style>
<canvas id="stage"></canvas>
<script>
${bundle}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} kB`);
