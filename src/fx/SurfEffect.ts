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
uniform vec2  uSunUv;      // position du soleil a l'ecran, en UV
uniform float uRays;       // 0 = soleil hors cadre, 1 = pleinement visible

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
    // atan(0, 0) est indefini en GLSL : au pixel exact du point de fuite il
    // peut rendre NaN, et un seul NaN suffit a noircir l'ecran entier (cf. le
    // pare-feu en fin de shader).
    float ang = dist > 1e-5 ? atan(dir.y, dir.x) : 0.0;
    float streak = hash12(vec2(floor(ang * 96.0), 1.0));
    float band = smoothstep(0.93, 1.0, streak) * smoothstep(0.30, 0.92, dist);
    col += vec3(0.55, 0.85, 0.95) * band * lines * 0.16;
  }

  // --- Le pop de carve pulse l'ecran en cyan.
  col += vec3(0.20, 0.60, 0.75) * uFlash * 0.28;
  // La charge tire vers le blanc sur les bords : la tension monte.
  col += vec3(0.55, 0.85, 1.0) * uCharge * smoothstep(0.45, 1.0, dist) * 0.08;

  // --- RAIS DE LUMIERE.
  //
  // Un flou radial DEPUIS LE SOLEIL, qui n'accumule que ce qui depasse un
  // seuil de luminance : les pixels de ciel sature autour de l'astre, et rien
  // d'autre. Les cretes et les nuages qui passent devant decoupent donc les
  // rais tout seuls — c'est de l'occlusion gratuite, obtenue sans jamais
  // savoir ce qu'il y a dans la scene.
  //
  // Douze echantillons : en dessous les rais se resolvent en bandes, au-dessus
  // on paie sans rien voir de plus.
  //
  // Le SEUIL est le reglage critique. A 0,72 il laissait passer le ciel entier :
  // chaque pixel de l'ecran accumulait douze echantillons de ciel clair et
  // l'image entiere virait au blanc. A 0,90 seuls le coeur du soleil et les
  // sommets de nuages qu'il brule alimentent les rais — ce qui est exactement
  // ce qui doit les alimenter.
  if (uRays > 0.01) {
    vec2 stride = (uv - uSunUv) * (0.42 / 16.0);
    // Depart DITHERE. Douze echantillons espaces regulierement rendent douze
    // copies fantomes de chaque objet lumineux — on voyait le personnage
    // reproduit en escalier dans le ciel. Decaler le depart d'une fraction de
    // pas, differente a chaque pixel, echange ces copies contre du grain, et
    // l'oeil lit du grain comme un volume.
    // Bruit de gradient entrelace plutot que bruit blanc. Concu pour ca : sa
    // repartition est uniforme sur chaque petit voisinage, donc l'oeil le lit
    // comme un lisse et non comme du grain. Le hachage aleatoire donnait une
    // neige blanche sur toute l'image.
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec2 pos = uv - stride * ign;
    float w = 1.0;
    vec3 shaft = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      pos -= stride;
      vec3 s = texture2D(inputBuffer, pos).rgb;
      // Seuil sur la LUMINANCE et non par canal : un anneau cyan sature
      // depasse 0,9 sur son canal vert sans etre pour autant une source de
      // lumiere. Seul ce qui est vraiment BLANC alimente un rai.
      //
      // Et un seuil PROGRESSIF, pas une coupure : avec une coupure franche,
      // un echantillon compte ou ne compte pas, la variance d'un pixel a
      // l'autre est maximale, et le tirage aleatoire du depart la transforme
      // en grain blanc sur toute l'image. La rampe divise cette variance.
      float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
      shaft += s * smoothstep(0.90, 1.02, lum) * w;
      w *= 0.90;
    }
    // Plafond : un rai reste un voile, jamais une source. Sans lui, un pixel
    // dont le rayon traverse le coeur du soleil de bout en bout brule.
    col += min(shaft * (1.0 / 16.0), vec3(0.22)) * vec3(1.00, 0.96, 0.84) * uRays * 3.2;
  }

  // --- Vignette douce.
  col *= 1.0 - smoothstep(0.42, 1.05, dist) * 0.28;

  // --- Etalonnage a la vitesse. L'image se contraste et se sature quand ca
  //     file : c'est ce qui fait que le boost se voit AVANT qu'on lise la
  //     jauge. Tres discret au repos, sinon la plaine devient criarde a l'arret.
  float drive = clamp(uSpeed * 0.6 + uBoost * 0.5, 0.0, 1.0);
  vec3 k = clamp(col, 0.0, 1.0);
  col = mix(col, k * k * (3.0 - 2.0 * k), drive * 0.18);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.0 + drive * 0.12);

  // --- Etalonnage bichrome : ombres vers le bleu, lumieres vers le chaud.
  //     C'est la separation de teinte qui distingue une image ETALONNEE d'une
  //     image simplement exposee, et elle coute deux mix.
  float sh = 1.0 - smoothstep(0.05, 0.45, lum);
  float hi = smoothstep(0.55, 1.0, lum);
  col = mix(col, col * vec3(0.93, 0.99, 1.10), sh * 0.35);
  col = mix(col, col * vec3(1.06, 1.01, 0.94), hi * 0.30);

  // --- Pare-feu NaN, DERNIERE instruction du shader.
  //
  // Un seul pixel non fini suffit a noircir TOUTE l'image : le bloom le
  // moyenne a chaque niveau de mipmap et la tache se propage au cadre entier.
  // C'est le mecanisme le plus plausible d'un flash noir d'une seule frame.
  //
  // isnan() n'existe pas en GLSL ES 1.00 : on se sert de la seule propriete
  // portable, toute comparaison impliquant NaN est FAUSSE. Le repli est la
  // texture d'entree (le rendu brut, avant bloom), donc un pixel abime reste
  // un pixel abime au lieu de contaminer l'ecran.
  float energy = dot(col, col);
  bool finite = energy >= 0.0 && energy < 1.0e12;
  outputColor = vec4(finite ? col : texture2D(inputBuffer, uv).rgb, inputColor.a);
}
`;

/** Ramene une valeur non finie a un centre d'ecran neutre. */
function safe(v: number): number {
  return Number.isFinite(v) ? Math.min(2, Math.max(-1, v)) : 0.5;
}

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
        ['uSunUv', new Uniform(new Vector2(0.5, 1.2))],
        ['uRays', new Uniform(0)],
      ]),
    });
  }

  set(speed: number, boost: number, charge: number, flash: number, cx: number, cy: number): void {
    const u = this.uniforms;
    u.get('uSpeed')!.value = speed;
    u.get('uBoost')!.value = boost;
    u.get('uCharge')!.value = charge;
    u.get('uFlash')!.value = flash;
    // Le centre vient d'une PROJECTION : si le point de fuite passait derriere
    // la camera, la division perspective rendrait un infini, et tout le shader
    // partirait en NaN. On borne a une plage ou l'effet reste sense.
    (u.get('uCenter')!.value as Vector2).set(safe(cx), safe(cy));
  }

  /** Position du soleil a l'ecran et intensite des rais. */
  setSun(x: number, y: number, strength: number): void {
    (this.uniforms.get('uSunUv')!.value as Vector2).set(safe(x), safe(y));
    this.uniforms.get('uRays')!.value = Number.isFinite(strength)
      ? Math.max(0, Math.min(1, strength))
      : 0;
  }
}
