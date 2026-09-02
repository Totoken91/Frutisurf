import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing';
import { HalfFloatType, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Quality } from '../core/Engine';
import { SurfEffect } from './SurfEffect';

/**
 * Chaine de post-traitement (docs/01 §4).
 * Le bloom EST le gloss Frutiger Aero : sans lui, rien ne brille.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly surf = new SurfEffect();
  private bloom: BloomEffect;
  private camera: PerspectiveCamera;
  private motion = 0.55;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    quality: Quality,
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: 0,
    });
    this.camera = camera;
    this.composer.addPass(new RenderPass(scene, camera));

    // Le bloom EST le gloss du projet, mais un rayon trop large avale ce
    // qu'il est cense magnifier : a 0,72 l'etoile du soleil se noyait dans sa
    // propre halo et ne rendait plus qu'une tache blanche. Seuil un peu plus
    // haut, rayon plus court : les branches ressortent, l'herbe ne bave plus.
    this.bloom = new BloomEffect({
      intensity: 0.85,
      luminanceThreshold: 0.86,
      luminanceSmoothing: 0.16,
      radius: 0.58,
      mipmapBlur: true,
      kernelSize: quality === 'low' ? KernelSize.MEDIUM : KernelSize.LARGE,
    });

    const effects =
      quality === 'low'
        ? [this.bloom, this.surf]
        : [this.bloom, this.surf, new SMAAEffect({ preset: SMAAPreset.MEDIUM })];

    this.composer.addPass(new EffectPass(camera, ...effects));
  }

  /** Le combo sature progressivement l'image : a combo 10 c'est presque trop beau. */
  setCombo(combo: number): void {
    this.bloom.intensity = 0.92 + Math.min(combo, 10) * 0.055;
  }

  /**
   * Dose du flou de mouvement, 0..1.
   *
   * Elle n'est PAS proportionnelle a la vitesse : la reprojection mesure deja
   * le deplacement reel, donc le flou monte tout seul quand ca va vite. Ce
   * reglage sert a autre chose — a decider de combien on triche. Un peu de
   * flou en permanence pose l'image ; beaucoup au boost fait l'evenement.
   */
  setMotion(speed: number, boost: number): void {
    this.motion = 0.40 + speed * 0.30 + boost * 0.65;
  }

  resize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    // Le point de vue est enregistre AVANT le rendu : la reprojection compare
    // cette image a la precedente, et il faut donc que la matrice poussee soit
    // celle avec laquelle la scene va etre dessinee.
    this.camera.updateMatrixWorld();
    this.surf.camera(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
      dt,
      this.motion,
    );
    this.composer.render(dt);
  }
}
