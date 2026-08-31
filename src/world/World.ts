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
import { Rings } from './Rings';
import { Clouds } from './Clouds';
import { Ground } from './Ground';
import { GrassBlades } from './GrassBlades';
import { Motes } from './Motes';
import { createEnvironment } from './Environment';
import { createSky, SUN_DIR } from './Sky';
import type { Quality } from '../core/Engine';

/**
 * Assemblage du decor. Tout est ancre sur `origin` (la position du surfeur) :
 * le joueur ne s'eloigne jamais de l'origine, c'est le monde qui recule.
 */
export class World {
  readonly ground: Ground;
  readonly blades: GrassBlades | null;
  readonly motes: Motes;
  readonly clouds: Clouds;
  readonly city = new City();
  readonly boosters: Boosters;
  readonly rings: Rings;
  readonly lights = new Group();
  private sky: Mesh;

  constructor(scene: Scene, renderer: WebGLRenderer, quality: Quality) {
    const dense = quality !== 'low';
    this.ground = new Ground(dense, quality === 'low' ? 384 : 512);
    // Le champ de touffes existe MEME en qualite basse, avec un rayon reduit.
    // Il avait d'abord ete coupe la par prudence, mais c'est une erreur de
    // diagnostic : le poste couteux sur telephone etait la transmission du
    // verre (un rendu de scene complet par image), pas la geometrie. Vingt-cinq
    // mille triangles a shader trivial ne coutent rien, et sans eux le premier
    // plan redevient l'aplat vert que le jeu vient justement de quitter.
    this.blades = new GrassBlades(quality === 'high' ? 64 : quality === 'medium' ? 46 : 40, 0.38);
    // L'atlas est genere au boot pixel par pixel : sa resolution est le seul
    // poste de chargement du jeu. 768 sur machine confortable, 512 sinon.
    // Effectifs revus a la baisse : a 72 nuages le ciel etait sature et le
    // banc d'horizon masquait completement la ville.
    this.clouds = new Clouds(
      quality === 'high' ? 44 : quality === 'medium' ? 34 : 24,
      quality === 'low' ? 512 : 768,
    );
    this.boosters = new Boosters(dense ? 6 : 5);
    this.rings = new Rings(dense ? 8 : 6);
    this.motes = new Motes(quality === 'high' ? 420 : quality === 'medium' ? 280 : 170);

    scene.environment = createEnvironment(renderer);
    this.sky = createSky();
    scene.add(this.sky);
    scene.add(this.ground.mesh);
    if (this.blades) scene.add(this.blades.mesh);
    scene.add(this.city.group);
    scene.add(this.clouds.mesh);
    scene.add(this.boosters.mesh);
    scene.add(this.rings.veil, this.rings.group);
    scene.add(this.motes.mesh);

    // Key : les highlights speculaires du verre.
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.copy(SUN_DIR).multiplyScalar(100);

    // Hemisphere : le rebond VERT du sol dans le buddy. Indispensable.
    const hemi = new HemisphereLight(col('skyMid').getHex(), col('grassMid').getHex(), 1.5);

    // Fill : debouche le contre-jour sans tuer le rim.
    const fill = new DirectionalLight(col('buddyHot').getHex(), 0.6);
    fill.position.set(-40, 18, -60);

    this.lights.add(key, hemi, fill);
    scene.add(this.lights);
  }

  /** Nouvelle partie : le parcours entier est reseme devant le joueur. */
  reset(originZ: number): void {
    this.boosters.reseedAll(originZ);
    this.rings.reseedAll(originZ);
  }

  update(origin: Vector3, camPos: Vector3, time: number, speedN: number, dt: number, cast: Vector3): void {
    // Le dome de ciel SUIT la camera. Fixe a l'origine, son bord finissait par
    // traverser la camera (le ciel scintillait), puis on en sortait et tout
    // passait au noir — apres environ 70 s de jeu a vitesse de croisiere.
    this.sky.position.copy(camPos);
    this.ground.update(camPos, origin, time, speedN, cast);
    this.blades?.update(origin, time, speedN);
    this.clouds.update(origin, time);
    this.city.update(origin);
    this.boosters.update(origin, time);
    this.rings.update(origin, time, dt);
    this.motes.update(origin, time);
  }
}
