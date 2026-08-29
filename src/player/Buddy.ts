import {
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import { HEX } from '../core/Palette';

/**
 * Le bonhomme MSN, reconstruit en verre epais.
 *
 * Silhouette de l'icone de contact Windows Live : une sphere de tete
 * DETACHEE du corps (il y a un vide entre les deux dans la reference) posee
 * sur un buste en cloche, base plate et large, epaules arrondies.
 *
 * Materiau : `transmission` pour qu'on voie l'herbe a travers, `thickness`
 * pour l'accumulation de teinte dans le volume, plus un rim de Fresnel
 * injecte dans le shader. Sans ce rim le buddy disparait dans le vert.
 */
export const BUDDY_HEIGHT = 2.14;

function bodyProfile(): Vector2[] {
  const H = 1.12;
  const RMAX = 0.82;
  const N = 34;
  const pts: Vector2[] = [new Vector2(0, 0)];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // L'exposant 0.5 donne la tangente verticale au sommet : epaules
    // arrondies. Le 3.0 garde la base large et presque droite.
    const r = RMAX * Math.pow(Math.max(0, 1 - Math.pow(t, 4.2)), 0.5);
    pts.push(new Vector2(Math.max(r, 0.0006), t * H));
  }
  return pts;
}

function glassMaterial(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: new Color(0x29beee),
    transmission: 0.88,
    // Une epaisseur de 1.4 avec une distance d'attenuation courte rendait le
    // buddy noir-petrole. Le verre de la reference est LUMINEUX : on garde
    // juste assez de volume pour la teinte, pas pour l'absorption.
    thickness: 0.55,
    ior: 1.42,
    roughness: 0.045,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: 0.45,
    iridescenceIOR: 1.6,
    attenuationColor: new Color(0x3aa8e0),
    attenuationDistance: 4.5,
    // Plancher lumineux : le buddy ne doit jamais tomber dans le noir, meme
    // dos a la lumiere.
    emissive: new Color(0x0d5f80),
    envMapIntensity: 2.2,
    transparent: true,
  });

  // Rim de Fresnel additif, injecte juste avant la composition finale.
  const rim = new Color(HEX.buddyRim);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimPower = { value: 1.9 };
    shader.uniforms.uRimGain = { value: 0.95 };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform vec3 uRim;\nuniform float uRimPower, uRimGain;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec3 rimN = normalize(normal);
          vec3 rimV = normalize(vViewPosition);
          float rimF = pow(1.0 - clamp(dot(rimN, rimV), 0.0, 1.0), uRimPower);
          outgoingLight += uRim * rimF * uRimGain;
        }
        #include <opaque_fragment>`,
      );
  };
  // Force une recompilation distincte de celle des autres materiaux physiques.
  m.customProgramCacheKey = () => 'buddy-glass-rim';
  return m;
}

export class Buddy {
  readonly group = new Group();
  readonly body: Mesh;
  readonly head: Mesh;

  constructor() {
    const mat = glassMaterial();

    this.body = new Mesh(new LatheGeometry(bodyProfile(), 64), mat);
    this.body.castShadow = false;

    this.head = new Mesh(new SphereGeometry(0.46, 48, 32), mat);
    // Vide franc entre le buste et la tete : c'est la signature de l'icone.
    this.head.position.y = 1.68;

    this.group.add(this.body, this.head);
  }

  /**
   * Squash & stretch. Absurde sur une icone en verre, et c'est exactement
   * pour ca que ca marche (docs/03 §5).
   */
  setSquash(squash: number): void {
    const y = 1 + squash;
    const xz = 1 - squash * 0.72;
    this.group.scale.set(xz, y, xz);
    // La tete suit le corps sans se deformer elle-meme : elle flotte.
    this.head.position.y = 1.68 - squash * 0.10;
  }
}
