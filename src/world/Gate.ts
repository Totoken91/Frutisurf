import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { GLSL_SAFE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { terrainHeight, waterLevel } from './Terrain';

/**
 * LA PORTE, et le systeme qui la place : LE RICOCHET.
 *
 * ---
 *
 * CE QU'ON A REMPLACE, ET POURQUOI.
 *
 * Avant : huit anneaux et seize colonnes vivaient en permanence dans le
 * couloir, visibles jusqu'a six cents metres, tous identiques, semes par un
 * tirage sur une bande de vingt metres autour de l'axe. Leur seul lien au monde
 * etait `terrainHeight`, pour se poser dessus. Quatre defauts en decoulaient, et
 * le joueur les a resumes d'un mot — du bruit qui se repete jusqu'a l'horizon :
 *
 *   - AUCUNE DECISION. Un anneau valait 220 ou 400, une colonne 140, toujours.
 *     On ne choisissait jamais entre deux choses, on prenait le plus proche.
 *   - AUCUNE ESCALADE. Le champ a la premiere seconde et a la deux-centieme
 *     etait rigoureusement identique. La seule progression etait le sablier qui
 *     accelerait : de la PRESSION, pas du CHANGEMENT.
 *   - AUCUNE MEMOIRE. Le combo expirait en deux secondes et demie. Rien de ce
 *     qu'on faisait ne changeait ce qui arrivait ensuite.
 *   - VINGT-QUATRE OBJETS A L'ECRAN. C'est la definition du bruit.
 *
 * ---
 *
 * LE RICOCHET, EN UNE PHRASE.
 *
 * Il n'y a qu'UNE porte. Au moment exact ou on la franchit, la suivante est
 * posee LE LONG DU VECTEUR DE SORTIE :
 *
 *   - la DISTANCE suit la vitesse horizontale ;
 *   - la HAUTEUR suit la vitesse verticale ;
 *   - la DIRECTION est celle ou l'on pointait.
 *
 * Puis le terrain finit le travail : une porte haute s'ancre juste APRES une
 * crete (c'est elle qui donne le saut), et aucune porte ne se pose au-dessus de
 * l'eau. Le vecteur choisit le probleme, le monde choisit l'endroit.
 *
 * Ce que ca change, et c'est tout le sujet : LE JOUEUR ECRIT LA DIFFICULTE DE
 * SON PROPRE RUN. La prendre a plat et lentement donne une porte proche et
 * basse, qui paie une misere. La prendre EN PHASE MONTANTE au sommet d'une
 * crete, a pleine vitesse, envoie la suivante loin et haut — on vient de se
 * fabriquer un probleme qu'on ne sait pas encore resoudre.
 *
 * Trois consequences qu'on n'a pas eu a regler a la main :
 *
 *   1. LE PAIEMENT EST COHERENT PAR CONSTRUCTION. Il est fonction de la
 *      geometrie de la porte, donc de la difficulte qu'on s'est donnee. Il n'y
 *      a pas de table de valeurs arbitraires.
 *   2. CA S'AUTO-EQUILIBRE. Un joueur en difficulte genere naturellement des
 *      portes faciles et repart ; un bon joueur creuse son propre trou.
 *   3. LE TEMPS REND CE QU'IL FAUT, PAS PLUS. Une porte plate rembourse a peu
 *      pres le trajet qu'elle a coute ; seule une porte HAUTE fait un benefice.
 *      Le jeu force donc a monter en difficulte pour survivre, et c'est le
 *      joueur qui decide de combien.
 *
 * La perte n'est pas la mort : rater une porte ramene la chaine a zero, donc a
 * une porte proche et basse qui paie peu. On ne perd pas la partie, on perd son
 * escalade.
 */

/** Rayon median du tore. */
export const GATE_R = 7.0;
/** Rayon utile pour le passage : plus genereux que le trou geometrique. */
/**
 * Rayon utile pour le passage.
 *
 * La porte est le SEUL objet du jeu depuis le ricochet : elle a le droit d'etre
 * plus grande que les anneaux qu'elle remplace, et elle en a besoin. C'est par
 * son quart superieur que passe toute l'escalade, et une fenetre de deux metres
 * au sommet d'un anneau de cinq n'est pas un geste d'adresse, c'est un tirage.
 */
const PASS_R = GATE_R - 0.5;
const TUBE = 0.55;

/**
 * Portee : distance a laquelle la porte est posee, en metres.
 *
 * Le minimum n'est pas un reglage de confort, c'est une garantie de LISIBILITE :
 * en dessous de cent trente metres on n'a pas le temps de voir la porte, de
 * choisir sa ligne et d'armer un saut. C'est aussi ce qui empeche une porte de
 * naitre dans le dos du joueur apres une sortie tres lente.
 */
const REACH_MIN = 130;
const REACH_MAX = 340;
const REACH_K = 3.2;

/**
 * Hauteur du centre au-dessus du sol.
 *
 * Le minimum est celui de l'ancien anneau bas : la porte est plantee DANS le
 * sol, on l'enfile en roulant.
 *
 * ---
 *
 * CE QUI LA FAIT MONTER : PAR OU L'ON PASSE, PAS A QUELLE VITESSE.
 *
 * Le premier jet lisait la VITESSE VERTICALE au franchissement. C'etait faux,
 * et le journal du pilote l'a dit en dix lignes : sur vingt-six portes
 * d'affilee, la vitesse verticale au passage valait -11,7 puis -9,9 puis -6,0…
 * toujours negative. C'est mecanique — la porte est a deux cents metres, un
 * saut dure une seconde et demie, on a donc TOUJOURS repasse le sommet quand on
 * y arrive. La hauteur restait bloquee a son minimum et l'escalade ne demarrait
 * jamais. Le systeme entier ne pouvait pas fonctionner.
 *
 * Ce qu'on mesure maintenant, c'est PAR OU l'on est passe dans l'anneau. Le
 * tore fait 5,8 m de rayon : entrer par son quart superieur demande d'etre en
 * l'air a l'instant precis du franchissement, et c'est une decision prise dans
 * la derniere seconde, pas un etat subi. Le geste devient limpide — VISE LE
 * HAUT DE LA PORTE — et il est continu : passer au centre reconduit la meme
 * difficulte, passer bas la fait redescendre.
 *
 * Un residu de vitesse verticale reste dans le calcul, parce que franchir le
 * haut EN MONTANT vaut mieux que le franchir en retombant : c'est le meme
 * geste, mais mieux joue.
 */
const ABOVE_MIN = 3.4;
const ABOVE_MAX = 11;
const ABOVE_K = 1.35;

/** Au-dela de cette hauteur, la porte va chercher une crete pour se poser. */
const CREST_AT = 6.0;
/**
 * De combien la porte se pose APRES la crete.
 *
 * Et pas SUR la crete, ce qui serait l'erreur naturelle : pour franchir une
 * porte haute il faut deja etre en l'air quand on y arrive, donc la bosse qui
 * envoie doit etre AVANT.
 *
 * LA DISTANCE N'EST PAS UNE CONSTANTE, C'EST UN SOMMET DE PARABOLE. Posee a
 * vingt-huit metres pour tout le monde, une porte de six metres de haut etait
 * infranchissable : avec g = 22 m/s2, un saut qui monte a six metres a deja
 * REDESCENDU au sol au bout de vingt-huit metres a vitesse de croisiere. Le
 * sommet est a `v * sqrt(2h/g)` — d'ou une avance qui grandit avec la hauteur
 * demandee, et une porte qui attend le disque la ou il sera le plus haut.
 */
function crestLead(above: number): number {
  return 10 + above * 1.4;
}

/** Demi-largeur utile. Le couloir fait 34 m ; on garde une marge de manoeuvre. */
const LATERAL = 26;

/** Etat public d'une porte : le jeu en lit la valeur et le temps qu'elle rend. */
export interface GateState {
  pos: Vector3;
  /** Hauteur du centre au-dessus du sol, en metres. */
  above: number;
  /** Distance a laquelle elle a ete posee, en metres. */
  reach: number;
  /** Points de base, avant multiplicateur de chaine. */
  value: number;
  /** Secondes rendues au chrono. */
  time: number;
}

export interface GateHit {
  pass: boolean;
  /**
   * De combien on est passe au-dessus du centre, en metres. Negatif en
   * dessous. C'est LUI qui decide de la hauteur de la porte suivante.
   */
  lift: number;
  point: Vector3;
  state: GateState;
}

const GLASS = /* glsl */ `
${GLSL_SAFE}
  attribute float iAlpha, iFlash;
  varying vec3 vN, vV;
  varying vec2 vUv;
  varying float vAlpha, vFlash;
  void main(){
    vUv = uv;
    vAlpha = iAlpha; vFlash = iFlash;
    // Le passage fait GONFLER la porte : l'expansion se lit mieux en vision
    // peripherique qu'un changement de couleur.
    vec3 p = position * (1.0 + iFlash * 0.42);
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vN = nsafe(mat3(instanceMatrix) * normal, vec3(0.0, 1.0, 0.0));
    // La camera traverse la porte : sans garde, le vecteur de vue s'annule et
    // normalize rend NaN, donc du noir que le bloom etale.
    vV = nsafe(cameraPosition - wp.xyz, vec3(0.0, 0.0, 1.0));
    // Fondu de proximite : la camera passe REELLEMENT dedans, une a deux images
    // d'affilee. Un tore translucide double face dans lequel on entre remplit
    // tout le cadre.
    vAlpha *= smoothstep(0.8, 6.5, distance(cameraPosition, wp.xyz));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export class Gate {
  readonly group: InstancedMesh;
  readonly veil: InstancedMesh;
  /** La balise : une colonne de lumiere qui se voit PAR-DESSUS le relief. */
  readonly beacon: Mesh;

  /** La porte vivante. */
  private state: GateState = {
    pos: new Vector3(0, 0, -1e6),
    above: ABOVE_MIN,
    reach: REACH_MIN,
    value: 0,
    time: 0,
  };
  private alive = false;
  /** Le fantome : la porte qu'on vient de prendre, qui eclate et s'efface. */
  private ghost = new Vector3(0, 0, -1e6);
  private ghostFlash = 0;

  private torusMat: ShaderMaterial;
  private veilMat: ShaderMaterial;
  private beaconMat: ShaderMaterial;
  private m = new Matrix4();
  private q = new Quaternion();
  private one = new Vector3(1, 1, 1);
  private beaconScale = new Vector3(1, 1, 1);
  private aAlpha: InstancedBufferAttribute;
  private aFlash: InstancedBufferAttribute;
  private vAlphaAttr: InstancedBufferAttribute;
  private vFlashAttr: InstancedBufferAttribute;

  constructor() {
    // Deux instances et pas une : la vivante, et le fantome de la precedente
    // pendant qu'il eclate. Les faire vivre dans le meme maillage evite un
    // second appel de dessin pour un objet qui existe un tiers de seconde.
    const N = 2;
    const torus = new TorusGeometry(GATE_R, TUBE, 10, 46);
    const disc = new CircleGeometry(GATE_R - TUBE, 44);

    const alpha = new Float32Array(N).fill(0);
    const flash = new Float32Array(N);
    this.aAlpha = new InstancedBufferAttribute(alpha, 1);
    this.aFlash = new InstancedBufferAttribute(flash, 1);
    this.vAlphaAttr = new InstancedBufferAttribute(new Float32Array(N), 1);
    this.vFlashAttr = new InstancedBufferAttribute(new Float32Array(N), 1);
    torus.setAttribute('iAlpha', this.aAlpha);
    torus.setAttribute('iFlash', this.aFlash);
    disc.setAttribute('iAlpha', this.vAlphaAttr);
    disc.setAttribute('iFlash', this.vFlashAttr);

    this.torusMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCore: { value: vec3('buddyGlass') },
        uEdge: { value: vec3('discDriftB') },
      },
      vertexShader: GLASS,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uTime;
        uniform vec3 uCore, uEdge;
        varying vec3 vN, vV;
        varying vec2 vUv;
        varying float vAlpha, vFlash;
        void main(){
          if (vAlpha < 0.01) discard;
          vec3 N = nsafe(vN, vec3(0.0, 1.0, 0.0));
          vec3 V = nsafe(vV, vec3(0.0, 0.0, 1.0));
          // Le tube vu de profil est le plus lumineux : c'est ce qui donne du
          // VERRE plutot qu'un rond de couleur.
          float rim = pow(max(1.0 - abs(dot(N, V)), 1e-4), 2.0);
          // Une onde qui court le long du tube : elle dit que la porte est
          // ACTIVE, et elle se voit a trois cents metres alors qu'une couleur
          // fixe s'y confond avec le decor.
          float run = sin(vUv.x * 25.13 - uTime * 3.0) * 0.5 + 0.5;
          vec3 c = mix(uEdge, uCore, rim * 0.65 + run * 0.35) * (1.5 + vFlash * 3.0);
          float a = (0.42 + rim * 0.80 + run * 0.22 + vFlash * 1.2) * vAlpha;
          a = fsafe(a);
          gl_FragColor = vec4(fsafe3(c) * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.veilMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCore: { value: vec3('buddyGlass') },
      },
      vertexShader: GLASS,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uTime;
        uniform vec3 uCore;
        varying vec2 vUv;
        varying float vAlpha, vFlash;
        void main(){
          if (vAlpha < 0.01) discard;
          // Le voile est un SOUFFLE, pas une vitre : il se concentre au bord et
          // laisse le centre libre, sinon on ne voit plus le paysage a travers
          // la porte — et voir a travers, c'est ce qui la fait viser.
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.35, 1.0, r);
          float a = (ring * 0.16 + vFlash * 0.55) * vAlpha;
          a = fsafe(a);
          gl_FragColor = vec4(fsafe3(uCore) * a * 1.4, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.group = new InstancedMesh(torus, this.torusMat, N);
    this.veil = new InstancedMesh(disc, this.veilMat, N);
    this.group.frustumCulled = false;
    this.veil.frustumCulled = false;
    this.group.renderOrder = 6;
    this.veil.renderOrder = 5;

    // --- LA BALISE.
    //
    //     C'est la seule chose que l'ancien systeme faisait bien, et on la
    //     garde : une COLONNE plantee au sol se voit par-dessus une colline,
    //     la ou un anneau pose dans un creux disparait derriere elle. La
    //     difference, c'est qu'elle a maintenant un SENS — elle ne marque plus
    //     un ramassage anonyme, elle dit ou est la porte, et sa hauteur dit
    //     a quelle altitude il faudra arriver.
    const col = new CylinderGeometry(2.6, 3.4, 1, 14, 1, true);
    col.translate(0, 0.5, 0);
    this.beaconMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCore: { value: vec3('buddyGlass') },
        uEdge: { value: vec3('discDriftB') },
        /** 0 = porte roulante, 1 = porte qui exige un saut arme. */
        uHigh: { value: 0 },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        varying vec2 vUv;
        varying float vFade;
        varying vec3 vNw, vVw;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNw = nsafe(mat3(modelMatrix) * normal, vec3(0.0, 1.0, 0.0));
          vVw = nsafe(cameraPosition - wp.xyz, vec3(0.0, 0.0, 1.0));
          // Le surfeur TRAVERSE la balise : sans ce fondu, un cylindre double
          // face de six metres de large vu de l'interieur est un mur.
          vFade = smoothstep(1.0, 9.0, distance(cameraPosition, wp.xyz));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uTime, uHigh;
        uniform vec3 uCore, uEdge;
        varying vec2 vUv;
        varying float vFade;
        varying vec3 vNw, vVw;
        void main(){
          if (vFade < 0.01) discard;
          float up = vUv.y;
          // Pied franc, sommet dissous : la colonne se lit comme POSEE au sol
          // et non comme un tube qui flotte.
          float body = pow(max(1.0 - up, 1e-4), 2.0);
          float foot = smoothstep(0.09, 0.0, up);
          // Des chevrons qui MONTENT vers la porte. Sur une porte haute ils
          // vont deux fois plus vite : la balise dit d'un coup d'oeil, et de
          // loin, s'il va falloir sauter.
          float wave = sin(up * 26.0 - uTime * (3.2 + uHigh * 3.6)) * 0.5 + 0.5;
          float chevron = smoothstep(0.52, 1.0, wave) * body;
          float rim = pow(max(1.0 - abs(dot(nsafe(vNw, vec3(0.0, 1.0, 0.0)),
                                            nsafe(vVw, vec3(0.0, 0.0, 1.0)))), 1e-4), 2.2);
          // FRANCHEMENT CYAN, et pas un blanc pale : sur la plaine, la ville
          // de cristal est deja une forêt de colonnes claires a l'horizon, et
          // une balise blanche s'y perdait exactement la ou on la cherche.
          vec3 c = mix(uCore, uEdge, 0.25 + rim * 0.35) * (1.5 + uHigh * 0.6);
          float a = (body * 0.34 + chevron * 0.46 + rim * 0.46 + foot * 0.85) * vFade * 0.88;
          a = fsafe(a);
          gl_FragColor = vec4(fsafe3(c) * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.beacon = new Mesh(col, this.beaconMat);
    this.beacon.frustumCulled = false;
    this.beacon.renderOrder = 4;
    this.beacon.visible = false;
  }

  /** La porte courante, ou null si aucune n'est posee. */
  get current(): GateState | null {
    return this.alive ? this.state : null;
  }

  /**
   * POSE LA PROCHAINE PORTE DEPUIS L'ETAT DE SORTIE.
   *
   * C'est le coeur du systeme, et il tient en dix lignes : la vitesse decide de
   * la distance, la vitesse verticale de la hauteur, le cap de la direction.
   * Tout le reste — l'ancrage sur une crete, la sortie de l'eau — est du
   * travail que le MONDE fait par-dessus.
   *
   * @param slack 0..1 : de la clemence. A 1 la porte est posee au plus court et
   *   au plus bas, quoi qu'ait fait le joueur. Sert apres un rate : on ne
   *   punit pas deux fois.
   */
  place(x: number, z: number, vx: number, vy: number, vz: number, lift = 0, slack = 0): GateState {
    const speed = Math.hypot(vx, vz);
    const ease = Math.min(1, Math.max(0, slack));

    const reach = Math.min(
      REACH_MAX,
      Math.max(REACH_MIN, REACH_MIN + speed * REACH_K * (1 - ease)),
    );
    // `lift` = de combien on est passe AU-DESSUS du centre de la porte
    // precedente, en metres. La vitesse verticale n'y ajoute qu'un residu.
    const gain = Math.max(0, lift) + Math.max(0, vy) * 0.22;
    let above = Math.min(ABOVE_MAX, ABOVE_MIN + gain * ABOVE_K * (1 - ease));

    // Le cap. Repli sur l'axe si le surfeur est a l'arret : le monde defile
    // toujours vers les z negatifs, une porte derriere soi n'a aucun sens.
    const dx = speed > 0.5 ? vx / speed : 0;
    const dz = speed > 0.5 ? vz / speed : -1;
    let tx = x + dx * reach;
    let tz = z + dz * reach;
    // Jamais au-dela du couloir : une porte qu'on ne peut pas atteindre n'est
    // pas un defi, c'est une erreur de generation.
    tx = Math.max(-LATERAL, Math.min(LATERAL, tx));
    // Et jamais dans le dos : un cap lateral extreme pourrait, sur une longue
    // portee, ramener la cible derriere le joueur.
    tz = Math.min(tz, z - REACH_MIN * 0.6);

    // --- L'ANCRAGE SUR LA CRETE, pour les portes hautes seulement.
    //
    //     Une porte haute posee au hasard est infranchissable : il faut une
    //     bosse AVANT elle pour envoyer le disque. On cherche donc le sommet
    //     local le plus proche de la cible et on pose la porte juste apres.
    if (above > CREST_AT) {
      let bestZ = tz;
      let bestH = -1e9;
      for (let d = -45; d <= 45; d += 5) {
        const h = terrainHeight(tx, tz + d);
        if (h > bestH) {
          bestH = h;
          bestZ = tz + d;
        }
      }
      tz = bestZ - crestLead(above);
    }

    // --- JAMAIS AU-DESSUS DE L'EAU.
    //
    //     Une porte plantee dans un lac est a moitie noyee et devient
    //     infranchissable au sol. On la pousse vers l'avant jusqu'a la rive
    //     opposee — ce qui donne, gratuitement, des portes posees juste apres
    //     une traversee : exactement ou l'on veut recompenser un plane.
    for (let i = 0; i < 16 && terrainHeight(tx, tz) < waterLevel() + 0.8; i++) tz -= 11;

    const ground = Math.max(terrainHeight(tx, tz), waterLevel());
    // Sur l'eau, la porte reste basse : on ne demande pas de sauter depuis une
    // surface qui ne rend rien.
    if (terrainHeight(tx, tz) < waterLevel() + 0.8) above = Math.min(above, ABOVE_MIN + 1.5);

    const realReach = Math.hypot(tx - x, tz - z);
    this.state.pos.set(tx, ground + above, tz);
    this.state.above = above;
    this.state.reach = realReach;
    // --- CE QU'ELLE PAIE, ET IL N'Y A PAS DE TABLE DE VALEURS.
    //
    //     La valeur est une fonction de la GEOMETRIE de la porte, donc de la
    //     difficulte que le joueur s'est lui-meme donnee. C'est ce qui rend le
    //     systeme coherent sans reglage : on ne peut pas fabriquer une porte
    //     chere sans avoir fait le geste qui la rend chere.
    this.state.value = Math.round(80 + realReach * 1.1 + above * 46);
    // --- ET CE QU'ELLE REND AU CHRONO.
    //
    //     Cale pour qu'une porte PLATE rembourse a peu pres le trajet qu'elle
    //     coute, et pas plus. Seule la HAUTEUR fait un benefice : le jeu force
    //     donc a monter en difficulte pour survivre, et c'est le joueur qui
    //     decide de combien — tout l'inverse d'un sablier qui accelere seul.
    //
    //     LE DIVISEUR EST UNE VITESSE, ET C'EST LA VRAIE, PAS L'IDEALE. Cale a
    //     34 m/s — la vitesse dont on parle quand on parle du jeu — l'economie
    //     etait intenable : mesure sans aucune prise, le monde ne donne de
    //     lui-meme que 23 a 32 m/s selon le monde, 26 en moyenne. Le pilote du
    //     banc mourait en cinquante-trois secondes sur la plaine. Une economie
    //     se cale sur ce que le joueur a vraiment, pas sur son meilleur moment.
    //
    //     ET ON SURVIT DE DEUX FACONS, PAS D'UNE. La portee grandit avec la
    //     vitesse : a quarante metres par seconde, une porte plate redevient
    //     rentable alors qu'elle coule a vingt-six. Monter en hauteur ou monter
    //     en vitesse — deux competences, toutes deux payees, et le joueur
    //     choisit laquelle il travaille.
    this.state.time = realReach / 44 + above * 0.55;
    this.alive = true;
    this.ghostFlash = Math.max(this.ghostFlash, 0);
    return this.state;
  }

  /**
   * Franchissement du plan de la porte entre deux pas de simulation.
   *
   * On teste le PLAN, pas la proximite : a 45 m/s le surfeur avance de 0,4 m
   * par pas, et un test de sphere laisserait passer une porte sur deux.
   */
  cross(px: number, py: number, pz: number, x: number, y: number, z: number): GateHit | null {
    if (!this.alive) return null;
    const gz = this.state.pos.z;
    if (!(pz > gz && z <= gz)) return null;
    const span = pz - z;
    const t = span > 1e-6 ? (pz - gz) / span : 0;
    const ix = px + (x - px) * t;
    const iy = py + (y - py) * t;
    const dx = ix - this.state.pos.x;
    const dy = iy - this.state.pos.y;
    const pass = dx * dx + dy * dy < PASS_R * PASS_R;
    return { pass, lift: dy, point: this.state.pos, state: this.state };
  }

  /** Franchie : elle eclate et laisse un fantome. La suivante est posee par le jeu. */
  take(): void {
    this.ghost.copy(this.state.pos);
    this.ghostFlash = 1;
    this.alive = false;
  }

  /** Ratee : meme fantome, mais sans eclat — elle s'eteint. */
  fail(): void {
    this.ghost.copy(this.state.pos);
    this.ghostFlash = 0.45;
    this.alive = false;
  }

  /** Remise a zero : nouvelle partie. */
  reset(): void {
    this.alive = false;
    this.ghostFlash = 0;
    this.state.pos.set(0, 0, -1e6);
    this.ghost.set(0, 0, -1e6);
  }

  update(time: number, dt: number): void {
    this.torusMat.uniforms.uTime.value = time;
    this.veilMat.uniforms.uTime.value = time;
    this.beaconMat.uniforms.uTime.value = time;
    if (this.ghostFlash > 0) this.ghostFlash = Math.max(0, this.ghostFlash - dt * 2.4);

    // Instance 0 : la porte vivante. Instance 1 : le fantome.
    this.setSlot(0, this.state.pos, this.alive ? 1 : 0, 0);
    this.setSlot(1, this.ghost, this.ghostFlash, this.ghostFlash);

    this.beacon.visible = this.alive;
    if (this.alive) {
      const high = Math.min(1, Math.max(0, (this.state.above - ABOVE_MIN) / (ABOVE_MAX - ABOVE_MIN)));
      this.beaconMat.uniforms.uHigh.value = high;
      // ELLE MONTE BEAUCOUP PLUS HAUT QUE LA PORTE, et c'est tout son interet.
      //
      // Calee sur la hauteur de la porte — une dizaine de metres — la balise
      // etait CACHEE PAR LE RELIEF exactement dans le cas ou elle sert : une
      // porte posee derriere une crete. On la voyait donc uniquement quand on
      // n'en avait pas besoin. C'est la lecon des anciennes colonnes, qui
      // faisaient dix-neuf metres pour cette seule raison, et qu'on a failli
      // perdre en les supprimant.
      //
      // Ce n'est plus la hauteur qui annonce l'altitude a prendre — c'est
      // l'anneau lui-meme, et la vitesse des chevrons.
      const h = 34;
      this.beaconScale.set(1, h, 1);
      this.beacon.position.set(
        this.state.pos.x,
        this.state.pos.y - this.state.above,
        this.state.pos.z,
      );
      this.beacon.scale.copy(this.beaconScale);
    }
  }

  private setSlot(i: number, p: Vector3, alpha: number, flash: number): void {
    this.m.compose(p, this.q, this.one);
    this.group.setMatrixAt(i, this.m);
    this.veil.setMatrixAt(i, this.m);
    this.aAlpha.setX(i, alpha);
    this.aFlash.setX(i, flash);
    this.vAlphaAttr.setX(i, alpha);
    this.vFlashAttr.setX(i, flash);
    this.group.instanceMatrix.needsUpdate = true;
    this.veil.instanceMatrix.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aFlash.needsUpdate = true;
    this.vAlphaAttr.needsUpdate = true;
    this.vFlashAttr.needsUpdate = true;
  }
}
