/**
 * Aucun backtick dans un shader.
 *
 * Le GLSL du projet vit dans des template literals. Un backtick dans un
 * commentaire GLSL TERMINE la chaine, et l'erreur qui suit tombe des dizaines
 * de lignes plus bas, sur du code parfaitement valide. C'est arrive QUATRE
 * fois — deux fois en ecrivant des shaders, deux fois en documentant une
 * correction dans un commentaire. Une regle qu'on doit se rappeler est une
 * regle qu'on oubliera : autant la faire tenir par la machine.
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

const bad = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let depth = 0; // profondeur de template literal
  lines.forEach((line, i) => {
    // On ne suit pas la syntaxe complete : on compte les backticks non
    // echappes. A l'interieur d'un literal (profondeur impaire), un backtick
    // situe dans un commentaire GLSL (// ou *) est forcement une faute.
    const ticks = (line.match(/(?<!\\)`/g) ?? []).length;
    const inside = depth % 2 === 1;
    if (inside && ticks > 0) {
      const comment = /^\s*(\/\/|\*|\/\*)/.test(line);
      if (comment) bad.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
    depth += ticks;
  });
}

if (bad.length) {
  console.error('BACKTICK dans un commentaire de shader — la chaine sera coupee :');
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log(`OK — aucun backtick suspect dans ${files.length} fichiers.`);
