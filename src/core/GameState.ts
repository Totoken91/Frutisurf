/**
 * Etat partage, lu par le HUD et l'audio. Seul le Controller ecrit dedans.
 * docs/02-TECH-ARCHITECTURE.md §6.
 */
export interface GameState {
  speed: number;
  steer: number;
  lean: number;
  carveCharge: number;
  combo: number;
  comboTimer: number;
  score: number;
  distance: number;
  airborne: boolean;
  boosting: boolean;
  /** Jauge de boost 0..1 : remplie par les figures, videe en boostant. */
  boost: number;
  /** Elan du saut en cours d'armement, 0..1. */
  jumpWind: number;
  gliding: boolean;
  lipFactor: number;
  /** Tours de vrille en cours, en fraction de tour. Lu par le HUD en vol. */
  spinTurns: number;
  /** Multiplicateur de score courant. */
  mult: number;
  /** Au-dessus d'une etendue d'eau. */
  onWater: boolean;
  /** File sur la surface. */
  planing: boolean;
  /** S'est enfonce, faute de vitesse. */
  sunk: boolean;
  popFlash: number;
  fps: number;
  started: boolean;
}

export const createState = (): GameState => ({
  speed: 0,
  steer: 0,
  lean: 0,
  carveCharge: 0,
  combo: 0,
  comboTimer: 0,
  score: 0,
  distance: 0,
  airborne: false,
  boosting: false,
  boost: 0.5,
  jumpWind: 0,
  gliding: false,
  lipFactor: 0,
  spinTurns: 0,
  mult: 1,
  onWater: false,
  planing: false,
  sunk: false,
  popFlash: 0,
  fps: 60,
  started: false,
});
