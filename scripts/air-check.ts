/**
 * Verifie que l'elan, le timing sur la crete et le plane existent vraiment
 * comme mecaniques, et pas seulement dans les intentions.
 *
 * Depuis le passage au saut charge, le saut se declenche au RELACHEMENT :
 * les pilotes pilotent donc `jumpHeld`, pas un front d'appui.
 *
 * Cinq pilotes parcourent le meme terrain :
 *   - sol    : ne saute jamais. Mesure le vol que le RELIEF SEUL provoque.
 *   - tap    : tape court, sans armer ni viser.
 *   - arme   : maintient 0.6 s puis relache, sans viser la crete.
 *   - time   : arme A L'APPROCHE et relache pile sur la crete.
 *   - plane  : comme "time", puis re-maintient apres l'apex.
 *
 * On compare le vol PAR SAUT, pas le vol total : un bon planeur reste en l'air
 * plus longtemps, croise donc moins de cretes, et son total peut baisser alors
 * meme que chaque saut est meilleur.
 */
import { Controller } from '../src/player/Controller';
import type { Input } from '../src/core/Input';

const STEP = 1 / 120;
const DURATION = 90;

interface Bot {
  name: string;
  /** Doit-on maintenir le saut a cet instant ? */
  hold: (c: Controller, t: number) => boolean;
  boost: boolean;
}

interface Result {
  air: number;
  jumps: number;
  best: number;
  dist: number;
  combo: number;
  boostAvg: number;
  /** Boost REELLEMENT gagne par les figures, cumul des hausses de jauge. */
  boostEarned: number;
}

function run(bot: Bot): Result {
  const c = new Controller();
  let t = 0;
  let air = 0;
  let jumps = 0;
  let best = 0;
  let maxCombo = 0;
  let apex = 0;
  let boostSum = 0;
  let frames = 0;
  let earned = 0;
  let prevBoost = c.boost;

  const input = {
    steer: 0,
    jumpHeld: false,
    boostHeld: bot.boost,
    consumeJump: () => false,
  } as unknown as Input;

  while (t < DURATION) {
    if (c.hitstop > 0) {
      c.hitstop -= STEP;
      t += STEP;
      continue;
    }
    const wasAir = c.airborne;
    input.jumpHeld = bot.hold(c, t);

    c.step(STEP, input);

    if (c.airborne) {
      if (!wasAir) jumps++;
      air += STEP;
      apex = Math.max(apex, c.y - c.groundY);
    } else if (wasAir) {
      best = Math.max(best, apex);
      apex = 0;
    }
    maxCombo = Math.max(maxCombo, c.combo);
    if (c.boost > prevBoost) earned += c.boost - prevBoost;
    prevBoost = c.boost;
    boostSum += c.boost;
    frames++;
    t += STEP;
  }
  return { air, jumps, best, dist: c.distance, combo: maxCombo,
    boostAvg: boostSum / frames, boostEarned: earned };
}

/**
 * Comportement d'un joueur qui a compris le jeu : il MAINTIENT en permanence
 * pour garder l'elan arme, et ne relache que quand il est sur la crete.
 */
const aimLip = (c: Controller): boolean => c.lipFactor < 0.70;

const ground = run({ name: 'sol', boost: false, hold: () => false });
const groundFast = run({ name: 'sol+', boost: true, hold: () => false });
const tap = run({
  name: 'tap',
  boost: false,
  hold: (c, t) => !c.airborne && t % 1.7 < 0.08,
});
const wound = run({
  name: 'arme',
  boost: false,
  hold: (c, t) => !c.airborne && t % 1.7 < 0.6,
});
// Les deux pilotes a figures DEPENSENT aussi du boost : sans depense tout le
// monde plafonne a 100 % et le gain reel devient invisible.
const timed = run({ name: 'time', boost: true, hold: (c) => !c.airborne && aimLip(c) });
const glided = run({
  name: 'plane',
  boost: true,
  hold: (c) => (c.airborne ? c.vy < 1.2 : aimLip(c)),
});

const row = (n: string, r: Result): string =>
  `${n.padEnd(6)} vol ${r.air.toFixed(1).padStart(5)} s  ` +
  `sauts ${String(r.jumps).padStart(3)}  ` +
  `apex ${r.best.toFixed(2).padStart(5)} m  ` +
  `dist ${r.dist.toFixed(0).padStart(5)} m  ` +
  `combo ${String(r.combo).padStart(2)}  boost gagne ${r.boostEarned.toFixed(1).padStart(5)}`;

[['sol', ground], ['sol+', groundFast], ['tap', tap], ['arme', wound],
 ['time', timed], ['plane', glided]].forEach(([n, r]) => console.log(row(n as string, r as Result)));

const per = (r: Result): number => r.air / Math.max(1, r.jumps);
console.log(
  `\nvol par saut : tap ${per(tap).toFixed(2)} s -> arme ${per(wound).toFixed(2)} s ` +
    `(${(((per(wound) / per(tap)) - 1) * 100).toFixed(0)} %) -> time ${per(timed).toFixed(2)} s ` +
    `(${(((per(timed) / per(wound)) - 1) * 100).toFixed(0)} %) -> plane ${per(glided).toFixed(2)} s ` +
    `(${(((per(glided) / per(timed)) - 1) * 100).toFixed(0)} %)`,
);
console.log(
  `vol subi par le relief seul : ${(100 * ground.air / DURATION).toFixed(0)} % en croisiere, ` +
    `${(100 * groundFast.air / DURATION).toFixed(0)} % en boost`,
);

// --- Indulgences d'entree, testees de facon deterministe.
//
// Elles ne se voient dans aucune statistique de vol : ce sont des fenetres de
// quelques centiemes de seconde. On les pilote donc directement.
function tolerances(): { coyote: boolean; buffer: boolean } {
  const mk = (): { c: Controller; input: Input; launched: boolean } => {
    const c = new Controller();
    const state = { c, input: null as unknown as Input, launched: false };
    c.events.onJump = (_t: number, w: number) => { if (w > 0) state.launched = true; };
    state.input = {
      steer: 0, jumpHeld: false, boostHeld: false, consumeJump: () => false,
    } as unknown as Input;
    return state;
  };

  // Coyote : on arme au sol, on quitte le sol, on relache un poil trop tard.
  const a = mk();
  a.input.jumpHeld = true;
  for (let i = 0; i < 60; i++) a.c.step(STEP, a.input);   // 0.5 s d'elan
  a.c.airborne = true; a.c.vy = 1; a.c.y = a.c.groundY + 0.4;
  for (let i = 0; i < 10; i++) a.c.step(STEP, a.input);   // 0.08 s en l'air
  a.input.jumpHeld = false;
  a.c.step(STEP, a.input);
  const coyote = a.launched;

  // Tampon : on relache haut, trop tot, puis on touche le sol.
  const b = mk();
  b.input.jumpHeld = true;
  for (let i = 0; i < 60; i++) b.c.step(STEP, b.input);
  b.c.airborne = true; b.c.vy = 0; b.c.y = b.c.groundY + 6;
  for (let i = 0; i < 40; i++) b.c.step(STEP, b.input);
  b.input.jumpHeld = false;
  b.c.step(STEP, b.input);
  const releasedInAir = b.launched;
  b.c.y = b.c.groundY - 0.1;                              // contact
  b.c.step(STEP, b.input);
  const buffer = !releasedInAir && b.launched;

  return { coyote, buffer };
}

const tol = tolerances();
console.log(`\nindulgences : coyote ${tol.coyote ? 'ok' : 'ECHEC'}  ` +
  `tampon ${tol.buffer ? 'ok' : 'ECHEC'}`);

let bad = false;
const fail = (m: string): void => { console.error(`\nECHEC — ${m}`); bad = true; };
if (!tol.coyote) fail('le coyote ne rattrape pas un relachement juste apres le decollage.');
if (!tol.buffer) fail('le tampon ne rejoue pas un relachement anticipe a l atterrissage.');

if (per(wound) <= per(tap) * 1.20) fail("armer le saut ne paie pas : l'elan ne sert a rien.");
if (per(timed) <= per(wound) * 1.15) fail('viser la crete ne paie pas : la fenetre de timing ne sert a rien.');
if (per(glided) <= per(timed) * 1.20) fail("le plane n'allonge pas le vol.");
if (timed.jumps < 8) fail(`seulement ${timed.jumps} sauts en ${DURATION} s : le relief n'offre pas assez de cretes.`);
if (ground.air > DURATION * 0.30) {
  fail(`le relief seul envoie en l'air ${(100 * ground.air / DURATION).toFixed(0)} % du temps en croisiere : c'est un trampoline.`);
}
// Les figures doivent VRAIMENT recharger le boost, sinon la jauge est un decor.
// On compare le boost GAGNE a DEPENSE EGALE (les deux pilotes boostent), et
// pas le niveau moyen : sans depense tout le monde finit a 100 % et la moyenne
// ne dit rien.
if (timed.boostEarned <= groundFast.boostEarned * 1.3) {
  fail('les figures ne rechargent pas le boost plus vite que la recharge passive.');
}
if (!bad) console.log('\nOK — elan, timing, plane et economie de boost sont des mecaniques reelles.');
process.exitCode = bad ? 1 : 0;
