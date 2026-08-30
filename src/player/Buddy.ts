import {
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  Vector2,
} from 'three';

/**
 * Le bonhomme MSN, releve au pixel sur docs/reference.jpg.
 *
 * Trois choses que le premier jet avait fausses :
 *
 *  1. Le corps n'est PAS une cloche. Il bombe vers le tiers inferieur puis se
 *     resserre legerement vers une BASE PLATE. Une cloche monotone (large en
 *     bas, retrecissant vers le haut) donne une silhouette de pion d'echecs.
 *  2. La tete est ENFONCEE dans les epaules, pas suspendue au-dessus. Sur la
 *     reference son bas passe sous la ligne d'epaule ; c'est ce chevauchement
 *     qui fait lire "icone de contact" et non "bonhomme de neige".
 *  3. Chaque volume porte son PROPRE degrade vertical azur -> cyan blanc.
 *     C'est le marqueur le plus reconnaissable de l'icone Windows Live.
 */

/** Demi-largeur du buste. Toutes les autres cotes en derivent. */
const R = 0.80;

/** Rapports releves sur la reference puis cales au comparatif cote a cote. */
const BODY_H = 1.50 * R;
const HEAD_R = 0.660 * R;
/** La tete POSE sur l'epaule : elle mord de ~0.11 R, ni noyee ni flottante. */
const HEAD_Y = 1.97 * R;

export const BUDDY_HEIGHT = HEAD_Y + HEAD_R;

/** Degrade releve au pixel : sommet de la tete -> bas du buste. */
const GRAD_TOP = 0x0a8fe8;
const GRAD_BOTTOM = 0x6ff2fb;

/**
 * Silhouette du buste, relevee tous les 100 px sur la reference puis
 * normalisee (t = 0 a la base plate, t = 1 au sommet du dome).
 * Le maximum n'est pas a la base : il est a t = 0.42.
 */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.000, 1.000],
  [0.200, 1.000],
  [0.400, 0.985],
  [0.580, 0.935],
  [0.740, 0.828],
  [0.860, 0.655],
  [0.940, 0.455],
  [0.975, 0.310],
  [1.000, 0.000],
];

/** Catmull-Rom : lisse les points releves sans les trahir. */
function sampleProfile(t: number): number {
  const n = PROFILE.length;
  if (t <= PROFILE[0][0]) return PROFILE[0][1];
  if (t >= PROFILE[n - 1][0]) return PROFILE[n - 1][1];

  let i = 0;
  while (i < n - 2 && PROFILE[i + 1][0] < t) i++;

  const p0 = PROFILE[Math.max(0, i - 1)][1];
  const p1 = PROFILE[i][1];
  const p2 = PROFILE[i + 1][1];
  const p3 = PROFILE[Math.min(n - 1, i + 2)][1];

  const span = PROFILE[i + 1][0] - PROFILE[i][0];
  const u = span > 0 ? (t - PROFILE[i][0]) / span : 0;
  const u2 = u * u;
  const u3 = u2 * u;

  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

function bodyProfile(): Vector2[] {
  const N = 48;
  // Premier point au centre de la base : ferme le disque plat du dessous.
  const pts: Vector2[] = [new Vector2(0, 0)];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = Math.max(sampleProfile(t) * R, 0.0006);
    pts.push(new Vector2(r, t * BODY_H));
  }
  return pts;
}

/**
 * Verre colore. Le degrade est injecte dans le shader physique : il est
 * normalise sur la hauteur LOCALE de chaque volume, pour que la tete et le
 * buste balaient chacun toute la plage azur -> cyan, comme sur la reference.
 */
function glassMaterial(yMin: number, yMax: number, lowPower: boolean): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: 0xffffff, // neutralise : le degrade injecte pilote la couleur
    // La reference est bien plus OPAQUE qu'un verre creux : le vert ne
    // traverse qu'en lisiere et sous la base. Une transmission forte
    // effacait la couleur propre du personnage.
    // La transmission coute UN RENDU DE SCENE COMPLET par image : three.js
    // redessine tout l'opaque dans une cible dediee pour que le verre ait
    // quelque chose a refracter. Sur telephone c'est le poste le plus cher du
    // jeu — et a 0,18 son apport est marginal. On l'echange contre une simple
    // opacite, qui garde la translucidite sans la passe.
    transmission: lowPower ? 0 : 0.18,
    opacity: lowPower ? 0.93 : 1,
    thickness: lowPower ? 0 : 0.7,
    ior: 1.45,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: 0.22,
    iridescenceIOR: 1.5,
    attenuationColor: new Color(0x4cc8f0),
    attenuationDistance: 3.2,
    // Un env fort renvoyait tout le ciel blanc dans le verre et delavait
    // la couleur propre de l'icone.
    envMapIntensity: 0.45,
    transparent: true,
  });

  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTop = { value: new Color(GRAD_TOP) };
    shader.uniforms.uBottom = { value: new Color(GRAD_BOTTOM) };
    shader.uniforms.uYMin = { value: yMin };
    shader.uniforms.uYMax = { value: yMax };

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying float vGradY;\nuniform float uYMin, uYMax;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGradY = clamp((position.y - uYMin) / max(uYMax - uYMin, 1e-4), 0.0, 1.0);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying float vGradY;
         uniform vec3 uTop, uBottom;
         void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Courbe legerement biaisee vers le bas : sur la reference le cyan
        // clair occupe plus de place que l'azur.
        // La teinte de l'icone est portee par le terme ADDITIF plus bas, pas
        // par le lobe diffus : avec une key a 2.6 et un tone mapper, une
        // couleur saturee passee dans l'eclairage de scene ressort delavee.
        // Ici le diffus n'apporte qu'une reponse sourde a la lumiere.
        vec3 grad = mix(uBottom, uTop, pow(vGradY, 0.45));
        diffuseColor.rgb = grad * 0.22;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec3 gN = normalize(normal);
          vec3 gV = normalize(vViewPosition);
          vec3 gGrad = mix(uBottom, uTop, pow(vGradY, 0.45));

          // Plancher lumineux : l'icone ne tombe jamais dans le noir.
          outgoingLight += gGrad * 0.95;

          // Rim de Fresnel : c'est lui qui detache le buddy du fond vert.
          float gRim = pow(1.0 - clamp(dot(gN, gV), 0.0, 1.0), 2.6);
          outgoingLight += vec3(0.30, 0.85, 1.0) * gRim * 0.42;

          // Arete basse incandescente : sur la reference la lumiere du sol
          // entre par la base plate et allume tout le bord inferieur.
          float gFoot = smoothstep(0.16, 0.0, vGradY);
          outgoingLight += vec3(0.62, 1.0, 1.0) * gFoot * 0.30;

          // Relief lateral. La reference est franchement plus sombre sur le
          // flanc gauche ; sans ce gradient le volume reste plat et le verre
          // ressemble a du plastique imprime.
          outgoingLight *= 1.0 - 0.38 * smoothstep(0.02, 0.88, -gN.x);

          // Large voile speculaire haut-gauche, doux : la reference n'a pas
          // qu'un point brillant, elle a une plage lumineuse etalee.
          float gSheen = pow(clamp(dot(gN, normalize(vec3(-0.45, 0.80, 0.40))), 0.0, 1.0), 6.0);
          outgoingLight += vec3(0.75, 0.98, 1.0) * gSheen * 0.11;
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `buddy-glass-${yMin.toFixed(3)}-${yMax.toFixed(3)}`;
  return m;
}

export class Buddy {
  readonly group = new Group();
  readonly body: Mesh;
  readonly head: Mesh;

  constructor(lowPower = false) {
    this.body = new Mesh(new LatheGeometry(bodyProfile(), 72), glassMaterial(0, BODY_H, lowPower));

    this.head = new Mesh(
      new SphereGeometry(HEAD_R, 56, 40),
      glassMaterial(-HEAD_R, HEAD_R, lowPower),
    );
    this.head.position.y = HEAD_Y;

    // La tete est dessinee APRES le buste : a materiaux transparents egaux,
    // c'est l'ordre qui decide, et on veut voir l'epaule passer devant elle.
    this.head.renderOrder = 1;
    this.body.renderOrder = 2;

    this.group.add(this.head, this.body);
  }

  /** Squash & stretch — absurde sur une icone en verre, et c'est pour ca que ca marche. */
  setSquash(squash: number): void {
    const y = 1 + squash;
    const xz = 1 - squash * 0.72;
    this.group.scale.set(xz, y, xz);

    // La tete encaisse l'etirement a 40 % seulement : a pleine deformation
    // elle devient un oeuf et la silhouette MSN ne se lit plus. Le buste, lui,
    // s'etire franchement — c'est lui qui porte l'effet.
    this.head.scale.set(1 / (1 - squash * 0.43), 1 / (1 + squash * 0.6), 1 / (1 - squash * 0.43));
    this.head.position.y = HEAD_Y - squash * 0.10;
  }
}
