import {
  ShaderMaterial,
  Color,
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
import { Water } from './Water';
import { Palms } from './Palms';
import { Turbines } from './Turbines';
import { Daylight, pushDay } from './Daylight';
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
  readonly water: Water;
  readonly palms: Palms;
  readonly turbines: Turbines;
  /** L'heure. Source unique, relue par tous les materiaux ci-dessous. */
  readonly day = new Daylight();
  /** Tout ce qui doit recevoir l'heure. Une liste, pour n'en oublier aucun. */
  private lit: Array<{ uniforms: Record<string, { value: unknown } | undefined> }> = [];
  private key!: DirectionalLight;
  private hemi!: HemisphereLight;
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
    this.water = new Water(dense);
    this.palms = new Palms();
    this.turbines = new Turbines(dense ? 14 : 9);
    this.motes = new Motes(quality === 'high' ? 420 : quality === 'medium' ? 280 : 170);

    scene.environment = createEnvironment(renderer);
    this.sky = createSky();
    scene.add(this.sky);
    scene.add(this.ground.mesh);
    if (this.blades) scene.add(this.blades.mesh);
    scene.add(this.water.mesh);
    scene.add(this.palms.mesh, this.turbines.mesh);
    scene.add(this.city.group);
    scene.add(this.clouds.mesh);
    scene.add(this.boosters.mesh);
    scene.add(this.rings.veil, this.rings.group);
    scene.add(this.motes.mesh);

    // Key : les highlights speculaires du verre.
    const key = new DirectionalLight(0xffffff, 2.6);
    this.key = key;
    key.position.copy(SUN_DIR).multiplyScalar(100);

    // Hemisphere : le rebond VERT du sol dans le buddy. Indispensable.
    const hemi = new HemisphereLight(col('skyMid').getHex(), col('grassMid').getHex(), 1.5);
    this.hemi = hemi;

    // Fill : debouche le contre-jour sans tuer le rim.
    const fill = new DirectionalLight(col('buddyHot').getHex(), 0.6);
    fill.position.set(-40, 18, -60);

    this.lights.add(key, hemi, fill);

    // --- Le registre des materiaux eclaires. Une LISTE, tenue a la main : un
    //     balayage automatique de la scene attraperait aussi les materiaux qui
    //     n'ont pas d'heure (le HUD n'en a pas, les anneaux non plus), et
    //     surtout il attraperait silencieusement les futurs. Ici, ajouter un
    //     decor sans l'inscrire se voit tout de suite : il reste en plein midi.
    this.lit = [
      (this.sky.material as ShaderMaterial),
      this.ground.mat,
      this.water.mat,
      this.palms.mat,
      this.turbines.mat,
      this.clouds.mat,
      this.motes.mat,
    ].filter(Boolean) as typeof this.lit;
    if (this.blades) this.lit.push(this.blades.mat);
    this.applyDay();
    scene.add(this.lights);
  }

  /** Pousse l'heure courante dans chaque materiau et dans les deux lampes. */
  private applyDay(): void {
    const d = this.day;
    for (const m of this.lit) pushDay(m.uniforms, d);

    // Le dome de ciel a ses propres couleurs, qui SONT l'heure.
    const sky = (this.sky.material as ShaderMaterial).uniforms;
    (sky.uZenith.value as Color).copy(d.zenith);
    (sky.uHigh.value as Color).copy(d.high);
    (sky.uMid.value as Color).copy(d.mid);
    (sky.uHorizon.value as Color).copy(d.horizon);
    sky.uNight.value = d.night;

    // L'eau reflechit le ciel : ses deux couleurs de reflet viennent donc du
    // cycle et non de la palette. Sans ca, un lac garde un reflet de midi sous
    // un ciel de crepuscule, et c'est la premiere chose que l'oeil remarque.
    const w = this.water.mat.uniforms;
    (w.uSkyLow.value as Color).copy(d.horizon);
    (w.uSkyHigh.value as Color).copy(d.mid);

    this.key.color.copy(d.light);
    this.key.intensity = 2.6 * d.power;
    this.hemi.color.copy(d.mid);
    this.hemi.intensity = 1.5 * (0.45 + d.power * 0.55);
  }

  /** Nouvelle partie : le parcours entier est reseme devant le joueur. */
  reset(originZ: number): void {
    this.boosters.reseedAll(originZ);
    this.rings.reseedAll(originZ);
  }

  update(
    origin: Vector3,
    camPos: Vector3,
    time: number,
    speedN: number,
    dt: number,
    cast: Vector3,
    wake: Vector3,
  ): void {
    // Le dome de ciel SUIT la camera. Fixe a l'origine, son bord finissait par
    // traverser la camera (le ciel scintillait), puis on en sortait et tout
    // passait au noir — apres environ 70 s de jeu a vitesse de croisiere.
    // L'heure AVANT tout le reste : chaque couche doit lire la meme.
    this.day.step(dt);
    this.applyDay();
    this.sky.position.copy(camPos);
    this.ground.update(camPos, origin, time, speedN, cast);
    this.blades?.update(origin, time, speedN);
    this.water.update(camPos, origin, time, wake);
    this.palms.update(origin, time);
    this.turbines.update(origin, time);
    this.clouds.update(origin, time);
    this.city.update(origin);
    this.boosters.update(origin, time);
    this.rings.update(origin, time, dt);
    this.motes.update(origin, time);
  }
}
