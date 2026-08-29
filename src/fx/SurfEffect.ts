import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector2 } from 'three';

/**
 * Tous les effets pilotes par la glisse, fusionnes en un seul passage :
 * flou radial, aberration chromatique, lignes de vitesse, vignette et flash
 * de pop. Les separer couterait quatre lectures de framebuffer pour rien.
 *
 * Le centre est le point de fuite, pas le centre de l'ecran : quand le
 * surfeur carve, tout l'effet de vitesse pivote avec lui.
 */
const FRAG = /* glsl */ `
uniform float uSpeed;      // 0..1
uniform float uBoost;      // 0..1
uniform float uCharge;     // 0..1
uniform float uFlash;      // 0..1
uniform vec2  uCenter;     // point de fuite en UV

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 dir = uv - uCenter;
  float dist = length(dir);

  // --- Flou radial : 6 echantillons suffisent, la traine fait le reste.
  float blur = (uSpeed * 0.016 + uBoost * 0.028) * smoothstep(0.05, 0.75, dist);
  vec3 col = inputColor.rgb;
  if (blur > 0.0005) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float t = float(i) / 5.0;
      acc += texture2D(inputBuffer, uv - dir * blur * t).rgb;
    }
    col = mix(col, acc / 6.0, 0.62);
  }

  // --- Aberration chromatique : au repos elle doit etre presque invisible.
  float ca = (0.0006 + uBoost * 0.0029 + uFlash * 0.0035) * (0.35 + dist);
  if (ca > 0.0008) {
    col.r = texture2D(inputBuffer, uv + dir * ca).r;
    col.b = texture2D(inputBuffer, uv - dir * ca).b;
  }

  // --- Lignes de vitesse : stries radiales en espace ecran.
  float lines = smoothstep(0.55, 1.0, uSpeed) + uBoost * 0.55;
  if (lines > 0.01) {
    float ang = atan(dir.y, dir.x);
    float streak = hash12(vec2(floor(ang * 96.0), 1.0));
    float band = smoothstep(0.93, 1.0, streak) * smoothstep(0.30, 0.92, dist);
    col += vec3(0.55, 0.85, 0.95) * band * lines * 0.16;
  }

  // --- Le pop de carve pulse l'ecran en cyan.
  col += vec3(0.20, 0.60, 0.75) * uFlash * 0.28;
  // La charge tire vers le blanc sur les bords : la tension monte.
  col += vec3(0.55, 0.85, 1.0) * uCharge * smoothstep(0.45, 1.0, dist) * 0.08;

  // --- Vignette douce.
  col *= 1.0 - smoothstep(0.42, 1.05, dist) * 0.28;

  outputColor = vec4(col, inputColor.a);
}
`;

export class SurfEffect extends Effect {
  constructor() {
    super('SurfEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uSpeed', new Uniform(0)],
        ['uBoost', new Uniform(0)],
        ['uCharge', new Uniform(0)],
        ['uFlash', new Uniform(0)],
        ['uCenter', new Uniform(new Vector2(0.5, 0.5))],
      ]),
    });
  }

  set(speed: number, boost: number, charge: number, flash: number, cx: number, cy: number): void {
    const u = this.uniforms;
    u.get('uSpeed')!.value = speed;
    u.get('uBoost')!.value = boost;
    u.get('uCharge')!.value = charge;
    u.get('uFlash')!.value = flash;
    (u.get('uCenter')!.value as Vector2).set(cx, cy);
  }
}
