import { Vector3 } from 'three';
import { Engine } from './core/Engine';
import { World } from './world/World';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = new Engine(canvas);
const world = new World(engine.scene, engine.quality);

const origin = new Vector3(0, 0, 0);
engine.camera.position.set(0, 3.1, -6);

let t = 0;
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  t += dt;

  origin.z = t * 24;
  engine.camera.position.set(0, 3.1, origin.z - 6);
  engine.camera.lookAt(origin.x, 2.2, origin.z + 12);

  world.update(origin, engine.camera.position, dt, t, 0.4);
  engine.renderer.render(engine.scene, engine.camera);
}
requestAnimationFrame(frame);
