import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { col } from '../core/Palette';
import { City } from './City';
import { Boosters } from './Boosters';
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
  readonly ground: Ground;
  readonly clouds: Clouds;
  readonly city = new City();
  readonly boosters: Boosters;
  readonly lights = new Group();
  private sky: Mesh;

  constructor(scene: Scene, renderer: WebGLRenderer, quality: Quality) {
    const dense = quality !== 'low';
    this.ground = new Ground(dense);
    this.clouds = new Clouds(quality === 'high' ? 46 : 26);
    this.boosters = new Boosters(dense ? 6 : 5);

    scene.environment = createEnvironment(renderer);
    this.sky = createSky();
    scene.add(this.sky);
    scene.add(this.ground.mesh);
    scene.add(this.city.group);
    scene.add(this.clouds.mesh);
    scene.add(this.boosters.mesh);

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
    // Le dome de ciel SUIT la camera. Fixe a l'origine, son bord finissait par
    // traverser la camera (le ciel scintillait), puis on en sortait et tout
    // passait au noir — apres environ 70 s de jeu a vitesse de croisiere.
    this.sky.position.copy(camPos);
    this.ground.update(camPos, origin, time, speedN);
    this.clouds.update(origin, time);
    this.city.update(origin);
    this.boosters.update(origin, time);
  }
}
