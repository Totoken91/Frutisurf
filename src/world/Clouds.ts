import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';

/**
 * Cumulus en billboards. La reference a des nuages PLATS et decoupes, pas des
 * volumetriques : fond plat, dessus bombe, typologie fond d'ecran.
 * Atlas 2x2 genere au boot, un seul draw call, billboard autour de Y
 * (un billboard complet roulerait avec la camera et trahirait le truc).
 */
function makeCloudAtlas(): CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const rng = new Rng(20240524);

  // 4 variantes dans un atlas 2x2
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * (S / 2);
    const oy = Math.floor(q / 2) * (S / 2);
    const H = S / 2;

    // Cumulus en chou-fleur : une rangee de lobes a la base + un ou deux
    // etages au-dessus. Une seule rangee donnerait une pastille horizontale.
    const lobes: Array<{ x: number; y: number; r: number }> = [];
    const nBase = rng.int(4, 6);
    for (let i = 0; i < nBase; i++) {
      const t = nBase === 1 ? 0.5 : i / (nBase - 1);
      const spread = Math.sin(Math.PI * t);
      lobes.push({
        x: 0.20 + t * 0.60 + rng.range(-0.04, 0.04),
        y: 0.64 - spread * 0.06,
        r: 0.085 + spread * rng.range(0.035, 0.075),
      });
    }
    const nUp = rng.int(2, 4);
    for (let i = 0; i < nUp; i++) {
      const t = nUp === 1 ? 0.5 : i / (nUp - 1);
      lobes.push({
        x: 0.30 + t * 0.40 + rng.range(-0.06, 0.06),
        y: 0.44 + rng.range(-0.05, 0.05),
        r: 0.095 + rng.range(0.0, 0.075),
      });
    }
    // Sommet occasionnel : casse la symetrie.
    if (rng.next() < 0.7) {
      lobes.push({ x: rng.range(0.36, 0.64), y: rng.range(0.26, 0.34), r: rng.range(0.08, 0.13) });
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < H; x++) {
        const u = x / H;
        const v = y / H;
        let field = 0;
        for (const l of lobes) {
          const dx = (u - l.x) / l.r;
          const dy = (v - l.y) / l.r;
          field += Math.exp(-(dx * dx + dy * dy) * 1.15);
        }
        // Base franche : on coupe net sous la ligne de flottaison.
        const floorCut = 1 - Math.max(0, (v - 0.74) / 0.06);
        let a = Math.min(1, Math.max(0, (field - 0.52) * 5.0)) * Math.max(0, floorCut);
        a = a * a * (3 - 2 * a);

        // Rouge = terme d'eclairage, alpha = couverture. La couleur est
        // recomposee dans le shader (cf. commentaire ci-dessus).
        const lit = Math.min(1, Math.max(0, (0.72 - v) * 2.6 + 0.55));
        const i = ((oy + y) * S + (ox + x)) * 4;
        d[i] = lit * 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = a * 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Clouds {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  readonly span = 2400;

  constructor(count = 46) {
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const off = new Float32Array(count * 3);
    const scl = new Float32Array(count * 2);
    const misc = new Float32Array(count * 3); // variante, opacite, phase
    const rng = new Rng(77);

    for (let i = 0; i < count; i++) {
      // Les nuages se concentrent sur la bande d'horizon, pas au zenith.
      const z = -rng.range(140, this.span);
      const depth = -z / this.span;
      off[i * 3] = rng.range(-1500, 1500);
      off[i * 3 + 1] = rng.range(30, 130) + depth * 55;
      off[i * 3 + 2] = z;

      const s = rng.range(110, 300) * (0.55 + depth * 0.85);
      scl[i * 2] = s;
      scl[i * 2 + 1] = s * rng.range(0.62, 0.82);

      misc[i * 3] = rng.int(0, 3);
      misc[i * 3 + 1] = rng.range(0.78, 1.0);
      misc[i * 3 + 2] = rng.range(0, 100);
    }

    geo.setAttribute('iOffset', new InstancedBufferAttribute(off, 3));
    geo.setAttribute('iScale', new InstancedBufferAttribute(scl, 2));
    geo.setAttribute('iMisc', new InstancedBufferAttribute(misc, 3));

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uMap: { value: makeCloudAtlas() },
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uSpan: { value: this.span },
        uHorizon: { value: vec3('skyHorizon') },
        uCore: { value: vec3('cloudCore') },
        uShadow: { value: vec3('cloudShadow') },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iOffset;
        attribute vec2 iScale;
        attribute vec3 iMisc;
        uniform float uTime, uSpan;
        uniform vec3 uOrigin;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vDepth;

        void main(){
          // Repli du champ devant la camera : les nuages ne s'epuisent jamais.
          vec3 o = iOffset;
          o.z = uOrigin.z - mod(uOrigin.z - o.z, uSpan);
          o.x += uOrigin.x * 0.10 + sin(uTime * 0.05 + iMisc.z) * 14.0;

          // Billboard autour de Y uniquement.
          vec3 toCam = cameraPosition - o;
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 pos = o + right * position.x * iScale.x + vec3(0.0, 1.0, 0.0) * position.y * iScale.y;

          // Quadrant de l'atlas
          float q = iMisc.x;
          vec2 cell = vec2(mod(q, 2.0), floor(q * 0.5));
          vUv = (uv + cell) * 0.5;

          vDepth = clamp((uOrigin.z - o.z) / uSpan, 0.0, 1.0);
          vOpacity = iMisc.y;

          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uHorizon, uCore, uShadow;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vDepth;

        void main(){
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.01) discard;
          // Blanc franc sur les sommets, teinte froide sous les lobes.
          vec3 c = mix(uShadow, uCore, t.r);
          // Les nuages lointains se dissolvent dans la brume d'horizon.
          c = mix(c, uHorizon, vDepth * 0.42);
          float a = t.a * vOpacity * (1.0 - vDepth * 0.22);
          // Fondu d'apparition en fond de zone : jamais de pop.
          a *= smoothstep(1.0, 0.86, vDepth);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mat.blending = NormalBlending;

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -700;
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
  }
}
