import {
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export type Quality = 'low' | 'medium' | 'high';

/** Detection au boot ; PostFX et GrassField s'y adaptent. */
function detectQuality(): Quality {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  quality: Quality;

  /** Repli automatique si la moyenne glissante depasse 20 ms (docs/02 §5). */
  private frameAcc = 0;
  private frameCount = 0;
  private downgraded = false;
  onQualityDrop: ((q: Quality) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = detectQuality();

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // SMAA s'en charge dans la chaine de post
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Neutral (Khronos PBR Neutral) au lieu d'ACES : ACES desature violemment
    // les cyans et verts quasi hors-gamut de la reference et rend l'image pastel.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(this.pixelRatio());

    this.camera = new PerspectiveCamera(62, 1, 0.1, 2600);
    this.camera.position.set(0, 3, -7);

    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('orientationchange', this.resize);
  }

  private pixelRatio(): number {
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    return Math.min(devicePixelRatio || 1, cap);
  }

  readonly resize = (): void => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.(w, h);
  };

  onResize: ((w: number, h: number) => void) | null = null;

  /** Appele chaque frame avec le temps d'image en ms. */
  sampleFrame(ms: number): void {
    if (this.downgraded) return;
    this.frameAcc += ms;
    this.frameCount++;
    if (this.frameCount < 120) return;
    const avg = this.frameAcc / this.frameCount;
    this.frameAcc = 0;
    this.frameCount = 0;
    if (avg > 20 && this.quality !== 'low') {
      this.quality = this.quality === 'high' ? 'medium' : 'low';
      this.downgraded = true;
      this.renderer.setPixelRatio(this.pixelRatio());
      this.onQualityDrop?.(this.quality);
    }
  }

  dispose(): void {
    removeEventListener('resize', this.resize);
    removeEventListener('orientationchange', this.resize);
    this.renderer.dispose();
  }
}
