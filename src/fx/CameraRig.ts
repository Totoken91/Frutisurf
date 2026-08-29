import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, Decay, lerp, smoothstep } from '../core/Spring';
import { fbm2D } from '../core/Noise';
import { terrainHeight } from '../world/Terrain';
import type { Controller } from '../player/Controller';

/**
 * La camera fait la moitie du travail (docs/03 §4).
 *
 * Les trois parametres qui vendent la glisse, dans l'ordre :
 *  1. le ROLL — sans lui un virage rapide ne se RESSENT pas ;
 *  2. le FOV qui monte — compression des bords, sensation de vent ;
 *  3. le recul de l'offset a haute vitesse — la camera "lache du lest".
 */
export class CameraRig {
  private pos = new Vector3(0, 3, 8);
  private look = new Vector3();
  private shake = new Decay(6.5);
  private fovPunch = new Decay(3.2);
  private roll = 0;
  private fov = 62;

  constructor(private camera: PerspectiveCamera) {}

  /** Coup de fouet : pop de carve, atterrissage. */
  punch(shake: number, fov: number): void {
    this.shake.add(shake);
    this.fovPunch.add(fov);
  }

  update(dt: number, c: Controller, time: number): void {
    const sn = c.speedNorm;

    // La camera RECULE et descend quand ca accelere ; en plane elle recule
    // encore et prend de la hauteur pour donner a voir la ligne de vol.
    const glide = c.gliding ? 1 : 0;
    // Un peu plus haut qu'avant le relief : d'une camera rasante on ne voit
    // pas les collines, donc on ne peut pas les jouer.
    const offY = lerp(4.1, 3.6, sn) + glide * 1.2 + Math.min(c.y - c.groundY, 8) * 0.18;
    const offZ = lerp(9.6, 11.4, sn) + glide * 1.6;

    const targetX = c.x + c.steer.value * 1.35;
    const targetY = c.y + offY;
    const targetZ = c.z + offZ;

    // Ressort quasi critique : elle suit sans flotter.
    const k = 7.5;
    this.pos.x = damp(this.pos.x, targetX, k, dt);
    // L'axe vertical est BEAUCOUP plus mou que les deux autres : suivre le
    // relief au pixel pres donnerait une camera qui tressaute sur chaque bosse.
    this.pos.y = damp(this.pos.y, targetY, k * 0.42, dt);
    this.pos.z = damp(this.pos.z, targetZ, k * 1.6, dt);

    // Garde-fou : la camera ne rentre jamais dans une colline derriere le surfeur.
    const clearance = terrainHeight(this.pos.x, this.pos.z) + 1.6;
    if (this.pos.y < clearance) this.pos.y = clearance;

    this.shake.step(dt);
    this.fovPunch.step(dt);

    // Bruit de tenue en main : juste assez pour que l'image soit vivante.
    const nx = (fbm2D(time * 1.7, 0) - 0.5) * 2;
    const ny = (fbm2D(0, time * 1.7 + 31.4) - 0.5) * 2;
    const handheld = 0.35 * (Math.PI / 180) * (c.airborne ? 0.7 : 1);
    const sh = this.shake.value;

    this.camera.position.set(
      this.pos.x + nx * handheld * 6 + (Math.random() - 0.5) * sh,
      this.pos.y + ny * handheld * 6 + (Math.random() - 0.5) * sh,
      this.pos.z,
    );

    // Elle regarde DANS le virage, pas devant elle.
    // On vise un peu plus bas en plane : on veut voir ou on va retomber.
    this.look.set(c.x + c.steer.value * 2.3, c.y + 1.15 - glide * 1.3, c.z - 9.0);
    this.camera.lookAt(this.look);

    // Le roulis : le parametre le plus sous-estime du jeu video.
    const targetRoll = -c.lean.value * 0.28;
    this.roll = damp(this.roll, targetRoll, 9, dt);
    this.camera.rotateZ(this.roll);

    // FOV : courbe legerement exponentielle, plus un punch amorti.
    const targetFov = lerp(62, 86, Math.pow(sn, 1.3)) + this.fovPunch.value;
    this.fov = damp(this.fov, targetFov, 8, dt);
    this.camera.fov = clamp(this.fov, 55, 104);
    this.camera.updateProjectionMatrix();
  }

  /** Placement immediat, sans transitoire (demarrage, reset). */
  snap(c: Controller): void {
    this.pos.set(c.x, c.y + 4.1, c.z + 9.6);
    this.camera.position.copy(this.pos);
    this.roll = 0;
    this.fov = 62;
  }

  get rollValue(): number {
    return this.roll;
  }

  get fovNorm(): number {
    return smoothstep(62, 90, this.fov);
  }
}
