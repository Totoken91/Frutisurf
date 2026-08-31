import { Game } from './Game';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Exposition pour les captures automatisees (scripts/shot.mjs).
(window as unknown as Record<string, unknown>).__game = game;

/**
 * Sonde de diagnostic, chargee A LA DEMANDE : elle synchronise le pipeline
 * graphique a chaque image et n'a donc rien a faire dans une partie normale.
 * L'import dynamique la sort aussi du bundle principal.
 *
 * TROIS declencheurs, et le premier ne suffisait pas. Le jeu tourne le plus
 * souvent dans une visionneuse d'artefacts, c'est-a-dire dans une iframe qui a
 * sa PROPRE adresse : la chaine de requete tapee sur claude.ai ne lui parvient
 * jamais. L'outil etait donc inaccessible exactement la ou le joueur en a
 * besoin. Il faut pouvoir l'ouvrir depuis l'interieur.
 */
let diagOn = false;
function openDiag(): void {
  if (diagOn) return;
  diagOn = true;
  void import('./core/Diag').then((m) => m.attachDiag(game));
}

if (new URLSearchParams(location.search).has('diag')) openDiag();

// F3, ou I : aucune des deux ne pilote quoi que ce soit dans le jeu.
addEventListener('keydown', (e) => {
  if (e.code === 'F3' || e.code === 'KeyI') openDiag();
});

// Trois doigts poses en meme temps. Un doigt dirige, deux boostent : trois est
// le premier geste libre, et il ne risque pas d'arriver par accident.
addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length >= 3) openDiag();
  },
  { passive: true },
);
