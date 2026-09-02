/**
 * La structure de partie.
 *
 * Un runner sans fin ou l'on ne peut pas perdre n'a pas de tension, donc pas
 * de raison de recommencer. Le chrono est le seul vrai enjeu du jeu : il ne
 * descend jamais tout seul assez vite pour tuer un bon joueur, mais il ne
 * pardonne pas dix secondes sans rien accrocher.
 *
 * On ne meurt PAS d'un choc — rien ne casse la glisse, c'est le contrat
 * artistique du projet. On meurt de ne plus avoir de temps.
 */

export type Phase = 'running' | 'over';

/** Duree de depart. Assez courte pour que le premier anneau soit urgent. */
export const START_TIME = 30;
/** Plafond : sans lui, un bon debut mettait la suite a l'abri pour une minute. */
export const MAX_TIME = 45;

/**
 * Acceleration du sablier.
 *
 * Sans elle, un joueur qui enfile proprement les anneaux ne meurt JAMAIS : le
 * pilote automatique du test tenait cinq minutes et se serait arrete de
 * fatigue. Le score cessait d'etre une performance pour devenir une mesure de
 * patience. Le temps s'ecoule donc de plus en plus vite, jusqu'au double au
 * bout de deux minutes et demie — la maitrise allonge le run, elle ne le rend
 * pas eternel. Le pilote parfait du test meurt maintenant vers 250 s.
 */
const RAMP_SECONDS = 140;
/**
 * ET IL A BEAUCOUP BAISSE AVEC LE RICOCHET.
 *
 * A 1,4 le sablier doublait presque de vitesse en deux minutes et demie, et
 * c'etait la SEULE escalade du jeu : le semis d'anneaux, lui, ne changeait
 * jamais. Depuis que le joueur fabrique lui-meme des portes de plus en plus
 * longues et de plus en plus hautes, l'escalade vient de lui — empiler la
 * seconde par-dessus la premiere ne rendait pas le jeu plus tendu, elle
 * rendait la fin inevitable quoi qu'on fasse, ce qui est exactement ce qu'une
 * escalade ne doit pas faire.
 */
const RAMP_MAX = 0.30;

/**
 * UN RECORD PAR MONDE.
 *
 * Les quatre mondes n'ont ni le meme relief, ni la meme part d'eau, ni les
 * memes occasions de figures : un record unique les mettrait en concurrence et
 * la seule strategie gagnante serait de toujours jouer le plus genereux. Les
 * trois autres deviendraient alors du decor qu'on visite une fois.
 *
 * Une cle par monde, et chacun devient son propre defi. C'est aussi ce qui
 * rend le choix du monde reversible : y revenir ne coute pas son record.
 */
const KEY = 'frutigersurfer.best.v3';

function readBest(world: string): number {
  try {
    const v = Number(localStorage.getItem(`${KEY}.${world}`));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    // localStorage leve dans certains bacs a sable : jamais sans garde.
    return 0;
  }
}

function writeBest(world: string, v: number): void {
  try {
    localStorage.setItem(`${KEY}.${world}`, String(Math.round(v)));
  } catch {
    /* pas de persistance : le record vit le temps de la session */
  }
}

export class Run {
  phase: Phase = 'running';
  timeLeft = START_TIME;
  elapsed = 0;
  /** Le monde dont on tient le record. Change avec le monde choisi. */
  world = 'plaine';
  best = readBest('plaine');
  /** Vrai des l'instant ou le score du run passe devant le record. */
  recordBeaten = false;
  /** Score fige a la fin du run, pour l'ecran de fin. */
  finalScore = 0;
  finalDistance = 0;
  bestCombo = 0;
  /** La plus longue chaine de portes du run. */
  bestChain = 0;
  gates = 0;
  /** Temps gagne a la derniere prise, pour l'animation du chrono. */
  gainFlash = 0;
  /** Delai avant que la relance soit acceptee : evite de relancer par inertie. */
  private lockout = 0;

  /** Vitesse d'ecoulement du chrono. 1 au depart, 2 au bout de RAMP_SECONDS. */
  get drain(): number {
    return 1 + Math.min(RAMP_MAX, this.elapsed / RAMP_SECONDS);
  }

  /** Bascule sur le record d'un autre monde. Appele au choix du monde. */
  setWorld(id: string): void {
    this.world = id;
    this.best = readBest(id);
  }

  /** Temps ajoute par une prise. Toujours passer par ici pour le plafond. */
  addTime(seconds: number): void {
    if (this.phase !== 'running') return;
    this.timeLeft = Math.min(MAX_TIME, this.timeLeft + seconds);
    this.gainFlash = Math.max(this.gainFlash, Math.min(1, seconds / 4));
  }

  /** @returns vrai a la frame exacte ou le run se termine. */
  step(dt: number, score: number, combo: number, chain = 0): boolean {
    this.gainFlash = Math.max(0, this.gainFlash - dt * 2.6);
    if (this.phase === 'over') {
      this.lockout = Math.max(0, this.lockout - dt);
      return false;
    }
    this.elapsed += dt;
    this.bestCombo = Math.max(this.bestCombo, combo);
    this.bestChain = Math.max(this.bestChain, chain);
    if (score > this.best && this.best > 0) this.recordBeaten = true;
    this.timeLeft -= dt * this.drain;
    if (this.timeLeft > 0) return false;
    this.timeLeft = 0;
    this.end(score);
    return true;
  }

  private end(score: number): void {
    this.phase = 'over';
    this.finalScore = score;
    this.lockout = 0.6;
    if (score > this.best) {
      this.best = Math.round(score);
      this.recordBeaten = true;
      writeBest(this.world, this.best);
    }
  }

  get canRestart(): boolean {
    return this.phase === 'over' && this.lockout <= 0;
  }

  reset(): void {
    this.phase = 'running';
    this.timeLeft = START_TIME;
    this.elapsed = 0;
    this.recordBeaten = false;
    this.finalScore = 0;
    this.finalDistance = 0;
    this.bestCombo = 0;
    this.bestChain = 0;
    this.gates = 0;
    this.gainFlash = 0;
    this.lockout = 0;
  }
}
