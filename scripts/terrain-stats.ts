/**
 * Statistiques de relief, par jeu d'amplitudes.
 *
 * Un monde ne se regle pas a l'oeil dans un editeur : ce qui decide s'il est
 * jouable, ce sont quatre nombres. La part de course sous l'eau, l'espacement
 * des etendues, leur largeur, et la pente typique. On les mesure sur le vrai
 * terrain, le long de vraies trajectoires, avant de regarder quoi que ce soit.
 *
 * Le cas fatal qu'il faut exclure : une etendue si large qu'on ne puisse pas la
 * traverser d'un trait. A 34 m/s en glisse, une nappe de 300 m se traverse en
 * neuf secondes ; couler au milieu, c'est ressortir au pas trois cents metres
 * plus loin, soit la partie perdue. Un archipel n'est pas un ocean.
 */
import { AMP, setTerrain, terrainGradient, terrainHeight } from '../src/world/Terrain';

interface Probe {
  name: string;
  amp: number[];
  water: number;
}

const PROBES: Probe[] = [
  { name: 'plaine (actuel)', amp: [6.0, 3.6, 2.3, 1.05, 0.16], water: -5.5 },
];
// Balayage : on cherche l'archipel, pas l'ocean.
for (const a0 of [2.0, 3.0, 4.0]) {
  for (const a2 of [3.0, 4.0]) {
    for (const w of [-1.0, 0.0, 1.0]) {
      PROBES.push({ name: `oki a0=${a0} a2=${a2} w=${w}`, amp: [a0, 2.4, a2, 1.7, 0.2], water: w });
    }
  }
}
PROBES.push({ name: 'bliss', amp: [7.5, 4.2, 1.5, 0.5, 0.06], water: -60 });

const grad = { dx: 0, dz: 0 };

function measure(p: Probe): void {
  setTerrain(p.amp, p.water, 1.55, 3.2);

  // Trois trajectoires laterales differentes : le couloir fait 68 m de large et
  // le joueur ne roule pas sur une ligne.
  let wet = 0;
  let total = 0;
  const spans: number[] = [];
  const gaps: number[] = [];
  let slopeSum = 0;
  let slopeMax = 0;

  for (const x of [-20, 0, 20]) {
    let inWater = false;
    let runStart = 0;
    let lastEnd = 0;
    for (let z = 0; z > -12000; z -= 0.5) {
      const h = terrainHeight(x, z);
      const under = h < p.water;
      total++;
      if (under) wet++;
      if (under && !inWater) {
        inWater = true;
        runStart = z;
        if (lastEnd !== 0) gaps.push(lastEnd - z);
      } else if (!under && inWater) {
        inWater = false;
        spans.push(runStart - z);
        lastEnd = z;
      }
      if (!under) {
        terrainGradient(x, z, grad);
        const s = Math.abs(grad.dz);
        slopeSum += s;
        slopeMax = Math.max(slopeMax, s);
      }
    }
  }

  const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const pct = ((wet / total) * 100).toFixed(1);
  const wide = spans.length ? Math.max(...spans) : 0;
  const dry = mean(gaps);
  const amplitude = AMP.reduce((s, a) => s + a, 0);
  console.log(
    `${p.name.padEnd(24)} eau ${pct.padStart(5)}%  nappe moy ${mean(spans).toFixed(0).padStart(4)} m` +
      `  max ${wide.toFixed(0).padStart(5)} m  terre entre ${dry.toFixed(0).padStart(4)} m` +
      `  pente moy ${(Math.atan(slopeSum / total) * 57.3).toFixed(1)}deg max ${(Math.atan(slopeMax) * 57.3).toFixed(0)}deg` +
      `  relief ${amplitude.toFixed(1)} m`,
  );
}

for (const p of PROBES) measure(p);
