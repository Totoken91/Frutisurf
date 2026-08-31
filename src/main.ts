import { Game } from './Game';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Exposition pour les captures automatisees (scripts/shot.mjs).
(window as unknown as Record<string, unknown>).__game = game;

// Sonde de diagnostic, chargee A LA DEMANDE : elle synchronise le pipeline
// graphique a chaque image et n'a donc rien a faire dans une partie normale.
// L'import dynamique la sort aussi du bundle principal.
if (new URLSearchParams(location.search).has('diag')) {
  void import('./core/Diag').then((m) => m.attachDiag(game));
}
