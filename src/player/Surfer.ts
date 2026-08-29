import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { Buddy } from './Buddy';
import { Disc, DISC_RADIUS } from './Disc';

/**
 * Le sujet complet : le buddy pose sur le CD, plus le halo de contact.
 *
 * `rig` porte la position monde et le lacet ; `tilt` porte l'inclinaison de
 * carve. Les separer evite que le roulis ne parte dans la trajectoire.
 */
export class Surfer {
  readonly rig = new Group();
  readonly tilt = new Group();
  readonly buddy = new Buddy();
  readonly disc = new Disc();
  /** Hauteur de vol du disque au-dessus du sol : il ne touche jamais l'herbe. */
  readonly hover = 0.16;

  constructor(parent: Object3D) {
    this.disc.mesh.position.y = 0;
    // Le buddy LEVITE au-dessus du disque : sur la reference il y a un vide
    // franc entre la base plate et le CD, et c'est ce vide qui laisse lire
    // a la fois l'arete basse incandescente et l'ellipse complete du disque.
    this.buddy.group.position.y = 0.20;

    this.tilt.add(this.disc.group, this.buddy.group);
    this.rig.add(this.tilt);
    parent.add(this.rig);
    // Le halo vit au sol, hors du groupe incline : il ne doit pas basculer.
    parent.add(this.disc.halo);
  }

  private static readonly PLANE_N = new Vector3(0, 0, 1);
  private haloQ = new Quaternion();

  update(
    time: number,
    charge: number,
    speedN: number,
    airHeight: number,
    groundY: number,
    normal: Vector3,
  ): void {
    this.disc.update(time, charge, speedN, airHeight);
    this.disc.halo.position.set(this.rig.position.x, groundY + 0.04, this.rig.position.z);
    // La normale du plan est +Z avant rotation : on l'amene sur celle du sol.
    this.haloQ.setFromUnitVectors(Surfer.PLANE_N, normal);
    this.disc.halo.quaternion.copy(this.haloQ);
  }
}

export { DISC_RADIUS };
