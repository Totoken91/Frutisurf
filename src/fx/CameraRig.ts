import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, Decay, lerp, smoothstep } from '../core/Spring';
import { fbm2D } from '../core/Noise';
import { terrainHeight, WATER_LEVEL } from '../world/Terrain';
import type { Controller } from '../player/Controller';

/**
 * Plafonds de secousse. Les evenements se CUMULENT — un anneau, un plot et un
 * pop peuvent tomber dans la meme seconde sur un bon enchainement — et `Decay`
 * additionne sans borne. Sans plafond, c'est exactement au moment ou le joueur
 * reussit quelque chose que la camera devient inutilisable.
 */
const SHAKE_MAX = 1.0;
const FOV_PUNCH_MAX = 16;

/**
 * Amplitude angulaire de la secousse, en degres a pleine intensite.
 *
 * ANGULAIRE, et non plus en translation. La version precedente deplacait la
 * POSITION de la camera de `shake` metres — jusqu'a 35 cm sur un pop charge,
 * davantage en cumulant. A dix metres du sujet, ca donne certes le bon nombre
 * de pixels de deplacement, mais ca deplace aussi le POINT DE VUE : toute la
 * parallaxe se reorganise d'une image a l'autre, l'herbe au premier plan
 * balaie l'ecran, et l'oeil ne lit pas un impact mais une camera qu'on
 * arrache. Le cinema secoue l'orientation, pas le trepied.
 */
const SHAKE_DEG = 2.6;

/**
 * La camera fait la moitie du travail (docs/03 §4).
 *
 * Les trois parametres qui vendent la glisse, dans l'ordre :
 *  1. le ROLL — sans lui un virage rapide ne se RESSENT pas ;
 *  2. le FOV qui monte — compression des bords, sensation de vent ;
 *  3. le recul de l'offset a haute vitesse — la camera "lache du lest".
 */
export class CameraRig {
  private pos = new Vector3(0, 3, 8);
  private look = new Vector3();
  private shake = new Decay(6.5);
  private fovPunch = new Decay(3.2);
  private roll = 0;
  private fov = 62;

  constructor(private camera: PerspectiveCamera) {}

  /** Coup de fouet : pop de carve, atterrissage. */
  punch(shake: number, fov: number): void {
    this.shake.add(shake);
    this.fovPunch.add(fov);
    // Plafonnes APRES l'addition : c'est le cumul qu'on borne, pas l'evenement.
    // Un seul evenement n'a jamais pose de probleme ; c'est l'enchainement qui
    // envoyait la camera dans le decor.
    this.shake.value = Math.min(this.shake.value, SHAKE_MAX);
    this.fovPunch.value = clamp(this.fovPunch.value, -FOV_PUNCH_MAX, FOV_PUNCH_MAX);
  }

  update(dt: number, c: Controller, time: number): void {
    const sn = c.speedNorm;

    // La camera RECULE et descend quand ca accelere ; en plane elle recule
    // encore et prend de la hauteur pour donner a voir la ligne de vol.
    const glide = c.gliding ? 1 : 0;
    // Un peu plus haut qu'avant le relief : d'une camera rasante on ne voit
    // pas les collines, donc on ne peut pas les jouer.
    const offY = lerp(4.1, 3.6, sn) + glide * 1.2 + Math.min(c.y - c.groundY, 8) * 0.18;
    const offZ = lerp(9.6, 11.4, sn) + glide * 1.6;

    const targetX = c.x + c.steer.value * 1.35;
    const targetY = c.y + offY;
    const targetZ = c.z + offZ;

    // Ressort quasi critique : elle suit sans flotter.
    const k = 7.5;
    this.pos.x = damp(this.pos.x, targetX, k, dt);
    // L'axe vertical est BEAUCOUP plus mou que les deux autres : suivre le
    // relief au pixel pres donnerait une camera qui tressaute sur chaque bosse.
    this.pos.y = damp(this.pos.y, targetY, k * 0.42, dt);
    this.pos.z = damp(this.pos.z, targetZ, k * 1.6, dt);

    // Garde-fou : la camera ne rentre jamais dans une colline derriere le surfeur.
    // La garde au sol se prend sur la SURFACE, eau comprise : passer sous le
    // plan d'eau donnerait une frame vue du dessous, turquoise opaque.
    const clearance =
      Math.max(terrainHeight(this.pos.x, this.pos.z), WATER_LEVEL) + 1.6;
    if (this.pos.y < clearance) this.pos.y = clearance;

    this.shake.step(dt);
    this.fovPunch.step(dt);

    // Bruit de tenue en main : juste assez pour que l'image soit vivante.
    const nx = (fbm2D(time * 1.7, 0) - 0.5) * 2;
    const ny = (fbm2D(0, time * 1.7 + 31.4) - 0.5) * 2;
    const handheld = 0.35 * (Math.PI / 180) * (c.airborne ? 0.7 : 1);
    this.camera.position.set(
      this.pos.x + nx * handheld * 6,
      this.pos.y + ny * handheld * 6,
      this.pos.z,
    );

    // Elle regarde DANS le virage, pas devant elle.
    // On vise un peu plus bas en plane : on veut voir ou on va retomber.
    this.look.set(c.x + c.steer.value * 2.3, c.y + 1.15 - glide * 1.3, c.z - 9.0);
    this.camera.lookAt(this.look);

    // Le roulis : le parametre le plus sous-estime du jeu video.
    const targetRoll = -c.lean.value * 0.28;
    this.roll = damp(this.roll, targetRoll, 9, dt);
    this.camera.rotateZ(this.roll);

    // --- La secousse, APRES le cadrage : elle deregle la VISEE, elle ne
    //     deplace pas le point de vue.
    //
    // Deux corrections, et il a fallu les deux.
    //
    // 1. Elle portait sur la POSITION, jusqu'a 35 cm sur un pop charge. A dix
    //    metres du sujet ca fait le bon nombre de pixels, mais ca deplace le
    //    point de vue : toute la parallaxe se reorganise d'une image a l'autre
    //    et l'herbe du premier plan balaie l'ecran. Le cinema secoue
    //    l'orientation, pas le trepied.
    //
    // 2. Elle etait tiree d'un bruit echantillonne a 26x le temps. A 60 images
    //    par seconde l'argument avance de 0,43 par image, soit plus que la
    //    taille des motifs du bruit : deux images consecutives tiraient des
    //    valeurs quasi INDEPENDANTES — mesure a 0,19 d'ecart moyen et jusqu'a
    //    0,85 sur une plage de 2. C'etait du bruit blanc, exactement ce que le
    //    commentaire d'origine pretendait eviter. Une image entiere qui vibre
    //    au rythme de l'affichage, l'oeil ne l'appelle pas « secousse », il
    //    l'appelle « ca clignote ».
    //
    // Ralentir le bruit ne marchait pas non plus : l'enveloppe retombe en trois
    // dixiemes de seconde, pendant lesquelles un bruit lent n'a pas le temps de
    // bouger. On obtenait une pichenette statique qui s'efface, pas une
    // secousse.
    //
    // Ce qu'il faut est une OSCILLATION AMORTIE : une frequence franche, assez
    // basse pour rester continue a 60 Hz (une dizaine d'images par cycle), et
    // une enveloppe qui la tue en trois dixiemes de seconde. Trois frequences
    // incommensurables pour que les trois axes ne se remettent jamais en phase,
    // ce qui donnerait un mouvement mecanique et repetitif.
    const sh = this.shake.value;
    if (sh > 0.0005) {
      const rad = SHAKE_DEG * (Math.PI / 180) * sh;
      this.camera.rotateX(Math.sin(time * 49.6) * rad);
      this.camera.rotateY(Math.sin(time * 39.4 + 1.7) * rad);
      this.camera.rotateZ(Math.sin(time * 32.1 + 3.9) * rad * 0.6);
    }

    // FOV : courbe legerement exponentielle, plus un punch amorti.
    const targetFov = lerp(62, 86, Math.pow(sn, 1.3)) + this.fovPunch.value;
    this.fov = damp(this.fov, targetFov, 8, dt);
    this.camera.fov = clamp(this.fov, 55, 104);
    this.camera.updateProjectionMatrix();
  }

  /** Placement immediat, sans transitoire (demarrage, reset). */
  snap(c: Controller): void {
    this.pos.set(c.x, c.y + 4.1, c.z + 9.6);
    this.camera.position.copy(this.pos);
    this.roll = 0;
    this.fov = 62;
    // Sans ca, une nouvelle partie heritait de la secousse de la precedente.
    this.shake.value = 0;
    this.fovPunch.value = 0;
  }

  get rollValue(): number {
    return this.roll;
  }

  get fovNorm(): number {
    return smoothstep(62, 90, this.fov);
  }
}
