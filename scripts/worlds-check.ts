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
import { setWind } from '../src/world/Weather';
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
function play(worldIdx: number, maxSeconds = 600) {
  const def = WORLDS[worldIdx];
  setTerrain(def.amp, def.water, def.shore[0], def.shore[1], def.swell);
  // LE VENT AUSSI. L'oublier ici ferait mesurer un monde qui n'existe pas :
  // OCTOBRE serait declare jouable sur une version de lui-meme sans sa
  // mecanique principale. C'est exactement la faute que `swell` avait deja
  // faite — le banc mesurait un ocean plat parce qu'on ne le lui passait pas.
  setWind(def.wind);

  const run = new Run();
  const rings = new Rings(8, 20240607);
  const pad = new Pad();
  let sinks = 0;
  let skims = 0;
  let skimMeters = 0;
  let waves = 0;
  let flights = 0;
  // Combien le vent deporte-t-il, et combien le pilote passe-t-il de temps
  // colle au bord du couloir ? Le premier chiffre dit si le vent existe, le
  // second s'il est subissable.
  let windSum = 0;
  let windSteps = 0;
  let pinned = 0;
  const c = new Controller({
    onSink: () => sinks++,
    onSkim: (m, _p) => {
      skims++;
      skimMeters += m;
      run.addTime(Math.min(5.0, Math.sqrt(Math.max(m, 0) / 10) * 1.55));
    },
    onWave: () => {
      waves++;
      run.addTime(0.26);
    },
    onFlight: (sec) => {
      flights++;
      run.addTime(Math.min(4.0, Math.sqrt(sec) * 1.9));
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
    windSum += Math.abs(c.wind);
    windSteps++;
    if (Math.abs(c.x) > 30) pinned += STEP;
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
    waves,
    flights,
    skimMeters,
    stalled: (stalled / t) * 100,
    wind: windSteps ? windSum / windSteps : 0,
    pinned: (pinned / t) * 100,
  };
}

let bad = 0;
const fail = (m: string): void => {
  bad++;
  console.log(`  ECHEC  ${m}`);
};

console.log('monde        eau    nappe max  terre moy   survie   score    anneaux  coules  glisses  vagues   vols  enlise   vent  au bord');
const ref: number[] = [];
for (let i = 0; i < WORLDS.length; i++) {
  const def = WORLDS[i];
  setTerrain(def.amp, def.water, def.shore[0], def.shore[1], def.swell);
  setWind(def.wind);
  const g = geometry();
  const r = play(i);
  ref.push(r.seconds);
  const seuil = 19 / def.mods.plane;
  console.log(
    `${def.id.padEnd(12)} ${g.wet.toFixed(0).padStart(3)}%  ${g.widest.toFixed(0).padStart(8)} m` +
      ` ${(g.land === Infinity ? '  --' : g.land.toFixed(0)).padStart(9)} m` +
      ` ${r.seconds.toFixed(0).padStart(7)} s ${Math.round(r.score).toString().padStart(8)}` +
      ` ${r.rings.toString().padStart(8)} ${r.sinks.toString().padStart(7)}` +
      ` ${r.skims.toString().padStart(8)} ${r.waves.toString().padStart(7)} ${r.flights.toString().padStart(6)} ${r.stalled.toFixed(0).padStart(6)}%` +
      ` ${r.wind.toFixed(1).padStart(6)} ${r.pinned.toFixed(0).padStart(6)}%` +
      `  sortie ${seuil.toFixed(1).padStart(4)} m/s${seuil < 9 ? ' (insubmersible)' : ''}`,
  );

  // 1. Une nappe doit se traverser d'un trait — SAUF si le monde a rendu la
  //    noyade impossible.
  //
  //    Le seuil de sortie de glisse vaut PLANE_KEEP / plane. Quand il tombe
  //    sous le plancher de vitesse au sol (9 m/s), une fois dejauge on ne peut
  //    plus retomber, quelle que soit la distance : la largeur de la nappe
  //    cesse alors d'etre un danger. C'est le contrat de l'ocean, et le
  //    verifier ici plutot que de l'ecrire dans un commentaire evite qu'on
  //    remonte un jour `plane` sans s'apercevoir qu'on vient de rendre le
  //    monde mortel.
  const insubmersible = 19 / def.mods.plane < 9;
  if (!insubmersible && g.widest > 250) {
    fail(`${def.id} : nappe de ${g.widest.toFixed(0)} m, infranchissable si l'on coule`);
  }
  // 2. Il faut de quoi se relancer entre deux nappes — meme reserve.
  if (!insubmersible && g.land < 30) {
    fail(`${def.id} : ${g.land.toFixed(0)} m de terre entre deux nappes, trop court pour relancer`);
  }
  // 3. Le pilote doit tenir, et le seuil est ABSOLU.
  //
  //    Il etait relatif a la plaine, ce qui etait une erreur : le jour ou le
  //    banc s'est mis a crediter honnetement le temps des traversees, la plaine
  //    est passee de 217 s a plus de dix minutes, et la moitie de ce chiffre a
  //    condamne un monde qui tenait pourtant trois minutes. La question posee
  //    n'est pas « ce monde vaut-il la plaine », c'est « peut-on y jouer » —
  //    et 120 s, soit quatre parties completes, y repond sans dependre d'un
  //    autre monde.
  if (r.seconds < 120) fail(`${def.id} : ${r.seconds.toFixed(0)} s seulement, on ne peut pas y jouer`);
  // 4. Et il ne doit pas passer sa partie a ramer.
  if (r.stalled > 35) fail(`${def.id} : ${r.stalled.toFixed(0)} % du temps sous ${RELAUNCH} m/s`);
  // 5. LE VENT DOIT RESTER CORRIGEABLE.
  //
  //    Un vent qu'on ne peut pas contrer plaque le pilote contre la paroi du
  //    couloir et l'y garde : la trajectoire cesse d'etre un choix. Le seuil
  //    porte donc sur le temps passe au-dela de 30 m sur les 34 du couloir,
  //    pas sur la force du vent — c'est le RESULTAT qui compte, et il depend
  //    autant de l'autorite laterale du monde que de sa rafale.
  if (def.wind > 0 && r.pinned > 25) {
    fail(`${def.id} : ${r.pinned.toFixed(0)} % du temps colle au bord, le vent n'est pas corrigeable`);
  }
  // Et un monde qui declare du vent doit en produire : un `wind` pousse dans
  // le mauvais tableau ne se verrait nulle part ailleurs.
  if (def.wind > 0 && r.wind < def.wind * 0.2) {
    fail(`${def.id} : vent declare a ${def.wind} m/s, mesure a ${r.wind.toFixed(2)}`);
  }
}

console.log(bad ? `\n${bad} echec(s).` : `\nOK — les ${WORLDS.length} mondes sont jouables, mesures a l autopilote.`);
process.exitCode = bad ? 1 : 0;
