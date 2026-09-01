/**
 * Verification des ETENDUES D'EAU.
 *
 * La regle promise au joueur tient en une phrase : assez vite, on glisse ;
 * trop lent, on coule. Elle n'a de valeur que si les deux issues sont
 * atteignables et clairement separees. Quatre contrats :
 *
 *  1. les lacs se rencontrent SOUVENT — un mecanisme qu'on croise une fois par
 *     partie n'existe pas ;
 *  2. lance a pleine vitesse on traverse, sans exception ;
 *  3. lance au ralenti on coule, sans exception ;
 *  4. couler COUTE : la vitesse s'effondre et met du temps a revenir.
 *
 * Les deux seuils sont testes de part et d'autre de l'hysteresis : c'est elle
 * qui evite le clignotement planing/coule au milieu d'une nappe, et une
 * regression la ferait disparaitre en silence.
 */
import { Controller, type SurfInput } from '../src/player/Controller';
import { isWater, terrainHeight, waterLevel } from '../src/world/Terrain';

const STEP = 1 / 120;

class Pad implements SurfInput {
  steer = 0;
  jumpHeld = false;
  boostHeld = false;
  consumeJump(): boolean {
    return false;
  }
}

// --- 1. Densite des nappes sur un parcours reel, dans le couloir jouable.
{
  const SPAN = 6000;
  const CORRIDOR = 34;
  let wet = 0;
  let total = 0;
  let lakes = 0;
  let inLake = false;
  let width = 0;
  const widths: number[] = [];
  for (let z = 0; z > -SPAN; z -= 0.5) {
    // Echantillonne la LARGEUR du couloir, pas seulement l'axe : un lac que le
    // joueur peut contourner sans s'en apercevoir ne compte pas comme rencontre.
    let anyWet = false;
    for (let x = -CORRIDOR; x <= CORRIDOR; x += 4) if (isWater(x, z)) anyWet = true;
    const here = isWater(0, z);
    total++;
    if (here) wet++;
    if (anyWet && !inLake) {
      lakes++;
      width = 0;
    }
    if (anyWet) width += 0.5;
    if (!anyWet && inLake) widths.push(width);
    inLake = anyWet;
  }
  const avg = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 0;
  console.log(
    `nappes    ${((wet / total) * 100).toFixed(1)} % de l'axe sous l'eau   ` +
      `${lakes} lacs / ${SPAN / 1000} km   largeur moyenne ${avg.toFixed(0)} m`,
  );
  if (lakes < 12) throw new Error(`seulement ${lakes} lacs sur ${SPAN} m : on ne les rencontre pas assez`);
  if (avg > 140) throw new Error(`lacs de ${avg.toFixed(0)} m : trop larges pour etre traverses`);
}

interface Crossing {
  planed: boolean;
  sank: boolean;
  meters: number;
  exitSpeed: number;
  seconds: number;
}

/**
 * Amene le surfeur a la vitesse voulue, puis le lache tout droit jusqu'a la
 * premiere nappe et observe la traversee.
 */
function cross(speed: number, boost: boolean): Crossing {
  const pad = new Pad();
  let sank = false;
  let meters = 0;
  const c = new Controller({
    onSink: () => {
      sank = true;
    },
    onSkim: (m) => {
      meters = m;
    },
  });
  c.reset();

  // Cherche une nappe devant et place le surfeur juste avant sa rive.
  let z = c.z;
  while (!isWater(0, z - 30) && z > -6000) z -= 1;
  c.z = z;
  c.y = terrainHeight(0, z);

  let planed = false;
  let t = 0;
  let exitSpeed = 0;
  let seen = false;
  while (t < 30) {
    pad.boostHeld = boost;
    // Maintenu de force AVANT la nappe seulement : une fois dessus, c'est la
    // physique de l'eau qui doit decider, pas le banc d'essai.
    if (!c.onWater && !seen) c.speed = speed;
    c.step(STEP, pad);
    if (c.onWater) {
      seen = true;
      if (c.planing) planed = true;
    } else if (seen) {
      exitSpeed = c.speed;
      break;
    }
    t += STEP;
  }
  return { planed, sank, meters, exitSpeed, seconds: t };
}

const fails: string[] = [];

// --- 2 & 3. Les deux issues, de part et d'autre du seuil.
const cases: Array<[string, number, boolean, 'glisse' | 'coule']> = [
  ['lance a fond', 46, true, 'glisse'],
  ['vitesse de croisiere', 32, false, 'glisse'],
  ['juste au-dessus du seuil', 27, false, 'glisse'],
  ['juste en dessous', 22, false, 'coule'],
  ['au ralenti', 12, false, 'coule'],
];

for (const [name, speed, boost, expected] of cases) {
  const r = cross(speed, boost);
  const got = r.planed && !r.sank ? 'glisse' : 'coule';
  console.log(
    `${name.padEnd(24)} ${String(speed).padStart(3)} m/s -> ${got.padEnd(7)} ` +
      `${r.meters > 0 ? `${r.meters.toFixed(0)} m glisses, ` : ''}` +
      `sortie a ${r.exitSpeed.toFixed(1)} m/s`,
  );
  if (got !== expected) fails.push(`${name} (${speed} m/s) devait ${expected}, a fait ${got}`);
}

// --- 4. Couler doit COUTER. Sans cela l'erreur n'est qu'un changement de decor.
{
  const fast = cross(46, true);
  const slow = cross(12, false);
  if (slow.exitSpeed > 12) fails.push(`couler laisse ${slow.exitSpeed.toFixed(1)} m/s en sortie : trop indolore`);
  if (fast.exitSpeed < slow.exitSpeed * 2) {
    fails.push(
      `glisser ne paie pas : ${fast.exitSpeed.toFixed(1)} m/s contre ${slow.exitSpeed.toFixed(1)} m/s en coulant`,
    );
  }
  console.log(
    `cout de l'erreur         sortie ${fast.exitSpeed.toFixed(1)} m/s en glisse ` +
      `contre ${slow.exitSpeed.toFixed(1)} m/s en coulant`,
  );
}

// --- Hysteresis : une fois lance, on ne doit pas retomber au premier flottement.
{
  const pad = new Pad();
  const c = new Controller({});
  c.reset();
  let z = c.z;
  while (!isWater(0, z - 30) && z > -6000) z -= 1;
  c.z = z;
  c.y = terrainHeight(0, z);
  let flips = 0;
  let prev = false;
  let t = 0;
  while (t < 12) {
    if (!c.onWater) c.speed = 30;
    // Une fois sur l'eau, on relache : la vitesse retombe sous le seuil
    // d'ENTREE mais doit rester au-dessus du seuil de MAINTIEN.
    c.step(STEP, pad);
    if (c.planing !== prev) flips++;
    prev = c.planing;
    t += STEP;
  }
  console.log(`hysteresis               ${flips} bascule(s) planing sur 12 s de test`);
  if (flips > 6) fails.push(`${flips} bascules planing : l'hysteresis ne tient pas, la glisse clignote`);
}

console.log(`niveau d'eau ${waterLevel()} m`);

if (fails.length) {
  console.error('\nECHEC :');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK : la glisse et la noyade sont toutes deux atteignables et separees.');
