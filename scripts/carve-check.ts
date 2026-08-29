/**
 * Recette du doc 03 §9, critere 2 :
 * "Le carve enchaine gauche-droite doit etre PLUS RAPIDE que la ligne droite.
 *  Sinon personne ne carve, et tout le doc ne sert a rien."
 *
 * On simule le controleur seul, sans rendu, et on compare les distances.
 */
import { Controller } from '../src/player/Controller';
import type { Input } from '../src/core/Input';

const STEP = 1 / 120;
const DURATION = 40;

function fakeInput(steer: number): Input {
  return {
    steer,
    jumpHeld: false,
    boostHeld: false,
    consumeJump: () => false,
  } as unknown as Input;
}

function run(steerAt: (t: number) => number): { distance: number; combo: number } {
  const c = new Controller();
  let t = 0;
  let maxCombo = 0;
  while (t < DURATION) {
    if (c.hitstop > 0) c.hitstop -= STEP;
    else c.step(STEP, fakeInput(steerAt(t)));
    maxCombo = Math.max(maxCombo, c.combo);
    t += STEP;
  }
  return { distance: c.distance, combo: maxCombo };
}

const straight = run(() => 0);
// Carve alterne : ~1.9 s de charge par cote, puis relachement franc.
const PERIOD = 2.3;
const carve = run((t) => {
  const phase = t % PERIOD;
  if (phase > 1.9) return 0; // relachement -> pop
  return (Math.floor(t / PERIOD) % 2 === 0 ? 1 : -1);
});

const gain = ((carve.distance / straight.distance - 1) * 100).toFixed(1);
console.log(`ligne droite : ${straight.distance.toFixed(0)} m`);
console.log(`carve alterne: ${carve.distance.toFixed(0)} m  (combo max ${carve.combo})`);
console.log(`gain         : ${gain} %`);

if (carve.distance <= straight.distance) {
  console.error('\nECHEC — le carve n\'est pas plus rapide que la ligne droite.');
  process.exit(1);
}
if (carve.combo < 5) {
  console.error(`\nECHEC — le combo ne monte pas (max ${carve.combo}).`);
  process.exit(1);
}
console.log('\nOK — le carve recompense bien le joueur.');
