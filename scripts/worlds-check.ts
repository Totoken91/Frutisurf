/**
 * CHAQUE MONDE DOIT ETRE JOUABLE, ET CA SE MESURE.
 *
 * Un monde qui n'est qu'une palette differente ne demande aucune verification.
 * Des qu'il change le relief et le niveau de l'eau, il change le JEU, et il
 * devient possible d'en livrer un dans lequel on ne peut rien faire.
 *
 * C'est exactement ce qui est arrive : OKINAWA, moitie sous l'eau, coulait le
 * joueur dans le premier lagon — on demarre a 18 m/s, le seuil de dejaugeage
 * etait a 25, la vitesse tombait a 5, et il n'y avait plus assez de terre entre
 * deux nappes pour se relancer. La capture montrait un joli lagon turquoise et
 * le mot COULE en travers de l'ecran. Rien dans le code ne l'aurait signale.
 *
 * Ce banc pose trois questions a chaque monde :
 *
 *  1. GEOMETRIE — la nappe la plus large est-elle traversable ? Les bandes de
 *     terre sont-elles assez longues pour se relancer entre deux ?
 *  2. SURVIE — un pilote qui joue normalement tient-il un temps comparable a
 *     celui de la plaine ? Un monde deux fois plus court est une punition.
 *  3. NOYADE — combien de fois coule-t-on ? Zero est suspect (l'eau ne compte
 *     pas), beaucoup est fatal.
 */
import { Vector3 } from 'three';
import { Controller, type SurfInput } from '../src/player/Controller';
import { Run } from '../src/core/Run';
import { Rings } from '../src/world/Rings';
import { combine, MOUNTS, RIDERS } from '../src/core/Loadout';
import { setTerrain, terrainHeight, waterLevel } from '../src/world/Terrain';
import { WORLDS } from '../src/world/Worlds';

const STEP = 1 / 120;

class Pad implements SurfInput {
  steer = 0;
  jumpHeld = false;
  boostHeld = false;
  consumeJump(): boolean {
    return false;
  }
}

/** Vitesse minimale a laquelle on peut encore relancer une traversee. */
const RELAUNCH = 22;

function geometry(): { widest: number; land: number; wet: number } {
  let wet = 0;
  let total = 0;
  let widest = 0;
  const lands: number[] = [];
  const w = waterLevel();
  for (const x of [-24, -8, 8, 24]) {
    let inWater = false;
    let start = 0;
    let dryStart = 0;
    for (let z = 0; z > -14000; z -= 0.5) {
      const under = terrainHeight(x, z) < w;
      total++;
      if (under) wet++;
      if (under && !inWater) {
        inWater = true;
        start = z;
        if (dryStart !== 0) lands.push(dryStart - z);
      } else if (!under && inWater) {
        inWater = false;
        widest = Math.max(widest, start - z);
        dryStart = z;
      }
    }
  }
  const land = lands.length ? lands.reduce((s, v) => s + v, 0) / lands.length : Infinity;
  return { widest, land, wet: (wet / total) * 100 };
}

/** Le pilote de `check:run`, reduit a l'essentiel : il vise l'anneau suivant. */
function play(worldIdx: number, maxSeconds = 300) {
  const def = WORLDS[worldIdx];
  setTerrain(def.amp, def.water, def.shore[0], def.shore[1]);

  const run = new Run();
  const rings = new Rings(8, 20240607);
  const pad = new Pad();
  let sinks = 0;
  let skims = 0;
  let skimMeters = 0;
  const c = new Controller({
    onSink: () => sinks++,
    onSkim: (m) => {
      skims++;
      skimMeters += m;
    },
    onTrick: (t) => run.addTime(0.9 * t),
  });
  c.loadout = combine(RIDERS[0], MOUNTS[0], def.mods);
  rings.reseedAll(0);

  const origin = new Vector3();
  let t = 0;
  let stalled = 0;
  while (run.phase === 'running' && t < maxSeconds) {
    const next = rings.nextAhead(c.z);
    if (next) {
      const dz = c.z - next.pos.z;
      pad.steer = Math.max(-1, Math.min(1, (next.pos.x - c.x) / 5));
      pad.jumpHeld = next.high && dz < 60 && dz > 26;
    } else {
      pad.steer = 0;
      pad.jumpHeld = false;
    }
    const px = c.x;
    const py = c.y;
    const pz = c.z;
    c.step(STEP, pad);
    const hit = rings.cross(px, py, pz, c.x, c.y, c.z);
    if (hit?.pass) {
      rings.take(hit.index);
      c.collectRing(hit.high);
      run.addTime(hit.high ? 4 : 3);
      run.rings++;
    }
    // Temps passe SOUS la vitesse de relance : c'est la mesure de l'enlisement,
    // et elle vaut mieux que le compte de noyades. Couler une fois et repartir
    // est un incident ; couler et ne jamais retrouver sa vitesse est une panne.
    if (c.speed < RELAUNCH) stalled += STEP;
    origin.set(c.x, 0, c.z);
    rings.update(origin, t, STEP);
    run.step(STEP, c.score, c.combo);
    t += STEP;
  }
  return {
    seconds: t,
    score: c.score,
    rings: run.rings,
    sinks,
    skims,
    skimMeters,
    stalled: (stalled / t) * 100,
  };
}

let bad = 0;
const fail = (m: string): void => {
  bad++;
  console.log(`  ECHEC  ${m}`);
};

console.log('monde        eau    nappe max  terre moy   survie   score    anneaux  coules  glisses  enlise');
const ref: number[] = [];
for (let i = 0; i < WORLDS.length; i++) {
  const def = WORLDS[i];
  setTerrain(def.amp, def.water, def.shore[0], def.shore[1]);
  const g = geometry();
  const r = play(i);
  ref.push(r.seconds);
  console.log(
    `${def.id.padEnd(12)} ${g.wet.toFixed(0).padStart(3)}%  ${g.widest.toFixed(0).padStart(8)} m` +
      ` ${(g.land === Infinity ? '  --' : g.land.toFixed(0)).padStart(9)} m` +
      ` ${r.seconds.toFixed(0).padStart(7)} s ${Math.round(r.score).toString().padStart(8)}` +
      ` ${r.rings.toString().padStart(8)} ${r.sinks.toString().padStart(7)}` +
      ` ${r.skims.toString().padStart(8)} ${r.stalled.toFixed(0).padStart(6)}%`,
  );

  // 1. Une nappe doit se traverser d'un trait. A 34 m/s en glisse, 250 m font
  //    sept secondes : au-dela, couler au milieu coute la partie.
  if (g.widest > 250) fail(`${def.id} : nappe de ${g.widest.toFixed(0)} m, infranchissable si l'on coule`);
  // 2. Il faut de quoi se relancer entre deux nappes. De 5 a 25 m/s il faut
  //    une bonne seconde, soit une trentaine de metres.
  if (g.land < 30) fail(`${def.id} : ${g.land.toFixed(0)} m de terre entre deux nappes, trop court pour relancer`);
  // 3. Le pilote doit tenir. La moitie de la plaine est la limite basse.
  if (r.seconds < ref[0] * 0.5) fail(`${def.id} : ${r.seconds.toFixed(0)} s contre ${ref[0].toFixed(0)} s sur la plaine`);
  // 4. Et il ne doit pas passer sa partie a ramer.
  if (r.stalled > 35) fail(`${def.id} : ${r.stalled.toFixed(0)} % du temps sous ${RELAUNCH} m/s`);
}

console.log(bad ? `\n${bad} echec(s).` : '\nOK — les quatre mondes sont jouables, mesures a l autopilote.');
process.exitCode = bad ? 1 : 0;
