/**
 * Verifie que le saut TIME et le plane existent vraiment comme mecaniques,
 * et pas seulement dans les intentions.
 *
 * Quatre pilotes automatiques parcourent le meme terrain :
 *   - sol    : ne saute jamais. Mesure le vol que le RELIEF SEUL provoque.
 *   - naif   : appuie a intervalle regulier, sans regarder le relief
 *   - time   : appuie quand lipFactor depasse le seuil, donc sur la crete
 *   - plane  : comme "time", mais garde le saut enfonce apres l'apex
 *
 * On compare le vol PAR SAUT, pas le vol total : un bon planeur reste en l'air
 * plus longtemps, croise donc moins de cretes, et son total peut baisser alors
 * meme que chaque saut est meilleur.
 *
 * Le pilote "sol" est le garde-fou anti-trampoline : si le terrain seul envoie
 * le surfeur en l'air la moitie du temps, ce n'est plus un jeu de glisse.
 */
import { Controller } from '../src/player/Controller';
import type { Input } from '../src/core/Input';

const STEP = 1 / 120;
const DURATION = 90;

interface Bot {
  name: string;
  wantJump: (c: Controller, t: number) => boolean;
  hold: boolean;
  boost: boolean;
}

function run(bot: Bot): { air: number; jumps: number; best: number; dist: number; combo: number } {
  const c = new Controller();
  let t = 0;
  let air = 0;
  let jumps = 0;
  let best = 0;
  let maxCombo = 0;
  let edge = false;
  let apex = 0;

  const input = {
    steer: 0,
    jumpHeld: false,
    boostHeld: bot.boost,
    consumeJump: () => {
      const e = edge;
      edge = false;
      return e;
    },
  } as unknown as Input;

  while (t < DURATION) {
    if (c.hitstop > 0) {
      c.hitstop -= STEP;
      t += STEP;
      continue;
    }
    const wasAir = c.airborne;
    if (!c.airborne && bot.wantJump(c, t)) {
      edge = true;
      jumps++;
    }
    input.jumpHeld = bot.hold && c.airborne;

    c.step(STEP, input);

    if (c.airborne) {
      air += STEP;
      apex = Math.max(apex, c.y - c.groundY);
    } else if (wasAir) {
      best = Math.max(best, apex);
      apex = 0;
    }
    maxCombo = Math.max(maxCombo, c.combo);
    t += STEP;
  }
  return { air, jumps, best, dist: c.distance, combo: maxCombo };
}

const ground = run({ name: 'sol', hold: false, boost: false, wantJump: () => false });
const groundFast = run({ name: 'sol+', hold: false, boost: true, wantJump: () => false });

let naiveClock = 0;
const naive = run({
  name: 'naif',
  hold: false,
  boost: false,
  wantJump: (_c, t) => {
    if (t - naiveClock < 1.7) return false;
    naiveClock = t;
    return true;
  },
});
const timed = run({ name: 'time', hold: false, boost: false, wantJump: (c) => c.lipFactor > 0.7 });
const glided = run({ name: 'plane', hold: true, boost: false, wantJump: (c) => c.lipFactor > 0.7 });

const row = (n: string, r: ReturnType<typeof run>): string =>
  `${n.padEnd(7)} vol ${r.air.toFixed(1).padStart(5)} s  ` +
  `sauts ${String(r.jumps).padStart(3)}  ` +
  `apex ${r.best.toFixed(2).padStart(5)} m  ` +
  `dist ${r.dist.toFixed(0).padStart(5)} m  combo ${r.combo}`;

console.log(row('sol', ground));
console.log(row('sol+', groundFast));
console.log(row('naif', naive));
console.log(row('time', timed));
console.log(row('plane', glided));

const per = (r: ReturnType<typeof run>): number => r.air / Math.max(1, r.jumps);
const pNaive = per(naive);
const pTimed = per(timed);
const pGlide = per(glided);

console.log(`\nvol par saut : naif ${pNaive.toFixed(2)} s -> time ${pTimed.toFixed(2)} s ` +
  `(${(((pTimed / pNaive) - 1) * 100).toFixed(0)} %) -> plane ${pGlide.toFixed(2)} s ` +
  `(${(((pGlide / pTimed) - 1) * 100).toFixed(0)} %)`);
console.log(`apex : naif ${naive.best.toFixed(2)} m -> time ${timed.best.toFixed(2)} m`);
console.log(`vol subi par le relief seul : ${(100 * ground.air / DURATION).toFixed(0)} % en croisiere, ` +
  `${(100 * groundFast.air / DURATION).toFixed(0)} % en boost`);

let bad = false;
if (pTimed <= pNaive * 1.15) {
  console.error('\nECHEC — sauter sur la crete ne paie pas : la fenetre de timing ne sert a rien.');
  bad = true;
}
if (pGlide <= pTimed * 1.20) {
  console.error('\nECHEC — le plane n\'allonge pas le vol.');
  bad = true;
}
if (timed.jumps < 8) {
  console.error(`\nECHEC — seulement ${timed.jumps} cretes en ${DURATION} s : le relief n'en offre pas assez.`);
  bad = true;
}
if (ground.air > DURATION * 0.30) {
  console.error(`\nECHEC — le relief seul envoie en l'air ${(100 * ground.air / DURATION).toFixed(0)} % ` +
    'du temps en croisiere : c\'est un trampoline, plus une glisse.');
  bad = true;
}
if (!bad) console.log('\nOK — le timing et le plane sont des mecaniques reelles, et le sol reste le sol.');
process.exitCode = bad ? 1 : 0;
