import { Engine } from './core/Engine';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = new Engine(canvas);

function frame(): void {
  requestAnimationFrame(frame);
  engine.renderer.render(engine.scene, engine.camera);
}
frame();
