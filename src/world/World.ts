import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { col } from '../core/Palette';
import { City } from './City';
import { Clouds } from './Clouds';
import { Ground } from './Ground';
import { createEnvironment } from './Environment';
import { createSky, SUN_DIR } from './Sky';
import type { Quality } from '../core/Engine';

/**
 * Assemblage du decor. Tout est ancre sur `origin` (la position du surfeur) :
 * le joueur ne s'eloigne jamais de l'origine, c'est le monde qui recule.
 */
export class World {
  readonly ground = new Ground();
  readonly clouds: Clouds;
  readonly city = new City();
  readonly lights = new Group();

  constructor(scene: Scene, renderer: WebGLRenderer, quality: Quality) {
    this.clouds = new Clouds(quality === 'high' ? 46 : 26);

    scene.environment = createEnvironment(renderer);
    scene.add(createSky());
    scene.add(this.ground.mesh);
    scene.add(this.city.group);
    scene.add(this.clouds.mesh);

    // Key : les highlights speculaires du verre.
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.copy(SUN_DIR).multiplyScalar(100);

    // Hemisphere : le rebond VERT du sol dans le buddy. Indispensable.
    const hemi = new HemisphereLight(col('skyMid').getHex(), 0x3bff7a, 1.5);

    // Fill : debouche le contre-jour sans tuer le rim.
    const fill = new DirectionalLight(col('buddyHot').getHex(), 0.6);
    fill.position.set(-40, 18, -60);

    this.lights.add(key, hemi, fill);
    scene.add(this.lights);
  }

  update(origin: Vector3, camPos: Vector3, time: number, speedN: number): void {
    this.ground.update(camPos, origin.x, origin.z, time, speedN);
    this.clouds.update(origin, time);
    this.city.update(origin);
  }
}
