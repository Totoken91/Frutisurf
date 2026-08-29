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
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({
      intensity: 0.85,
      luminanceThreshold: 0.80,
      luminanceSmoothing: 0.22,
      radius: 0.72,
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

  resize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
