/**
 * Verification de la STRUCTURE DE PARTIE.
 *
 * Trois contrats, dans l'ordre d'importance :
 *  1. ne rien faire doit tuer — sinon le chrono n'est pas un enjeu ;
 *  2. enfiler les anneaux doit faire vivre nettement plus longtemps ;
 *  3. les anneaux hauts doivent etre atteignables, sinon ils ne sont qu'une
 *     punition deguisee.
 *
 * Le pilote est volontairement BETE : s'il y arrive avec une regle en trois
 * lignes, un humain y arrive.
 */
import { Vector3 } from 'three';
import { Controller, type SurfInput } from '../src/player/Controller';
import { Run } from '../src/core/Run';
import { Rings } from '../src/world/Rings';

const STEP = 1 / 120;
const RING_TIME = 3.0;
const RING_TIME_HIGH = 4.0;
const TRICK_TIME = 0.9;

interface Result {
  seconds: number;
  score: number;
  rings: number;
  high: number;
  missed: number;
  turns: number;
  maxCombo: number;
  air: number;
  maxSpin: number;
  jumps: number;
}

type Bot = (c: Controller, rings: Rings, input: Pad) => void;

/** Manette scriptee : le Controller ne doit voir aucune difference. */
class Pad implements SurfInput {
  steer = 0;
  jumpHeld = false;
  boostHeld = false;
  consumeJump(): boolean {
    return false;
  }
}

function play(bot: Bot, maxSeconds = 300): Result {
  const run = new Run();
  const rings = new Rings(8);
  const pad = new Pad();
  let turns = 0;
  let high = 0;
  let missed = 0;
  let maxCombo = 0;
  let air = 0;
  let maxSpin = 0;
  let jumps = 0;

  const c = new Controller({
    onTrick: (t) => {
      turns += t;
      run.addTime(TRICK_TIME * t);
    },
    onRingMiss: () => {
      missed++;
    },
    onJump: () => {
      jumps++;
    },
  });
  rings.reseedAll(0);

  const origin = new Vector3();
  let t = 0;
  while (run.phase === 'running' && t < maxSeconds) {
    const px = c.x;
    const py = c.y;
    const pz = c.z;
    bot(c, rings, pad);
    c.step(STEP, pad);

    const hit = rings.cross(px, py, pz, c.x, c.y, c.z);
    if (hit) {
      if (hit.pass) {
        rings.take(hit.index);
        c.collectRing(hit.high);
        run.addTime(hit.high ? RING_TIME_HIGH : RING_TIME);
        run.rings++;
        if (hit.high) high++;
      } else {
        c.missRing();
      }
    }
    maxCombo = Math.max(maxCombo, c.combo);
    if (c.airborne) air += STEP;
    maxSpin = Math.max(maxSpin, Math.abs(c.spin) / (Math.PI * 2));
    origin.set(c.x, 0, c.z);
    rings.update(origin, t, STEP);
    run.step(STEP, c.score, c.combo);
    t += STEP;
  }
  return { seconds: t, score: c.score, rings: run.rings, high, missed, turns, maxCombo, air, maxSpin, jumps };
}

/** Ne fait rien : il glisse tout droit. */
const idle: Bot = (_c, _r, pad) => {
  pad.steer = 0;
  pad.jumpHeld = false;
};

/**
 * Vise l'anneau suivant. Pour un anneau haut, il arme en approchant et lache a
 * distance fixe : c'est exactement ce qu'on demande au joueur, pas plus fin.
 */
const chaser: Bot = (c, rings, pad) => {
  const next = rings.nextAhead(c.z);
  if (!next) {
    pad.steer = 0;
    pad.jumpHeld = false;
    return;
  }
  const dz = c.z - next.pos.z;
  const dx = next.pos.x - c.x;
  pad.steer = Math.max(-1, Math.min(1, dx / 5));
  // Arme entre 60 et 26 m, relache a 26 m : la cloche du saut retombe alors
  // a peu pres sur l'anneau.
  pad.jumpHeld = next.high && dz < 60 && dz > 26;
};

/**
 * Le meme, plus les vrilles.
 *
 * Il vrille DU COTE de l'anneau suivant. C'est tout l'interet d'avoir fusionne
 * la vrille et la direction : tourner et viser vont dans le meme sens, donc la
 * figure ne s'oppose pas a la course — elle s'y greffe. Un pilote qui vrille au
 * hasard, lui, rate tout, et c'est normal.
 */
/**
 * Le meme profil de saut que le vrilleur, mais SANS vrille. C'est le temoin :
 * comparer le vrilleur au chasseur melangerait deux differences (il saute plus
 * ET il vrille) et ne dirait rien sur la valeur de la figure elle-meme.
 */
const jumper: Bot = (c, rings, pad) => {
  chaser(c, rings, pad);
  const next = rings.nextAhead(c.z);
  const dz = next ? c.z - next.pos.z : 999;
  if (!c.airborne && dz > 55) pad.jumpHeld = true;
};

let spinDir = 0;
const trickster: Bot = (c, rings, pad) => {
  chaser(c, rings, pad);
  const next = rings.nextAhead(c.z);
  const dz = next ? c.z - next.pos.z : 999;
  if (!c.airborne) {
    spinDir = 0;
    // Un saut de plus quand l'anneau suivant est encore loin : c'est la que se
    // trouve le temps de vol libre.
    if (dz > 55) pad.jumpHeld = true;
    return;
  }
  // On CHOISIT un sens au decollage et on s'y tient. Alterner annule la vrille,
  // et c'est exactement la contrainte qu'on veut valider.
  if (spinDir === 0) spinDir = next ? Math.sign(next.pos.x - c.x) || 1 : 1;
  pad.steer = spinDir;
};

function line(name: string, r: Result): void {
  console.log(
    `${name.padEnd(11)} ${r.seconds.toFixed(1).padStart(6)} s   ` +
      `${String(r.rings).padStart(3)} anneaux (${r.high} hauts, ${r.missed} rates)   ` +
      `${String(r.turns).padStart(3)} tours   combo max ${String(r.maxCombo).padStart(3)}   ` +
      `score ${Math.round(r.score).toLocaleString('fr-FR')}   ` +
      `vol ${r.air.toFixed(0)} s / ${r.jumps} sauts   vrille max ${r.maxSpin.toFixed(2)} tour`,
  );
}

const passif = play(idle);
const chasseur = play(chaser);
const sauteur = play(jumper);
const figures = play(trickster);

line('passif', passif);
line('chasseur', chasseur);
line('sauteur', sauteur);
line('figures', figures);

const fails: string[] = [];
if (passif.seconds > 40) fails.push(`ne rien faire survit ${passif.seconds.toFixed(0)} s : le chrono ne mord pas`);
if (chasseur.seconds < passif.seconds * 2) {
  fails.push(
    `chasser les anneaux ne paie pas assez (${chasseur.seconds.toFixed(0)} s contre ${passif.seconds.toFixed(0)} s)`,
  );
}
if (chasseur.high < 3) fails.push(`seulement ${chasseur.high} anneaux hauts pris : ils sont hors de portee`);
if (chasseur.missed > chasseur.rings) fails.push(`plus d'anneaux rates que pris : le semis est injouable`);
if (figures.turns < 8) fails.push(`les vrilles ne se declenchent pas (${figures.turns} tours)`);
const rateA = sauteur.score / sauteur.seconds;
const rateB = figures.score / figures.seconds;
if (rateB < rateA * 0.98) {
  fails.push(
    `a saut egal, vriller fait perdre du score a la seconde (${Math.round(rateB)} contre ${Math.round(rateA)})`,
  );
}
if (chasseur.seconds >= 299) fails.push('le chasseur ne meurt jamais : le sablier n\'accelere pas assez');

if (fails.length) {
  console.log('\nECHEC :');
  fails.forEach((f) => console.log('  -', f));
  process.exitCode = 1;
} else {
  console.log('\nOK — le chrono mord, les anneaux paient, les figures aussi.');
}
