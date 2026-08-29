import { Game } from './Game';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Exposition pour les captures automatisees (scripts/shot.mjs).
(window as unknown as Record<string, unknown>).__game = game;
