import { Group, Object3D } from 'three';
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
    // Le buddy repose sur la face superieure du disque.
    this.buddy.group.position.y = 0.03;

    this.tilt.add(this.disc.group, this.buddy.group);
    this.rig.add(this.tilt);
    parent.add(this.rig);
    // Le halo vit au sol, hors du groupe incline : il ne doit pas basculer.
    parent.add(this.disc.halo);
  }

  update(time: number, charge: number, speedN: number, airHeight: number): void {
    this.disc.update(time, charge, speedN, airHeight);
    this.disc.halo.position.set(this.rig.position.x, 0.02, this.rig.position.z);
  }
}

export { DISC_RADIUS };
