import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE, GLSL_SAFE } from '../core/Noise';

/**
 * L'AURA DE VITESSE, au-dela de 200 km/h.
 *
 * ---
 *
 * CE QU'ELLE DOIT ETRE, ET CE QU'ELLE NE DOIT PAS ETRE.
 *
 * Une aura ratee est un halo. On pose un sprite lumineux autour du personnage,
 * on le fait pulser, et le resultat est une tache qui suit — jamais une energie
 * qui monte. Trois choses separent l'une de l'autre :
 *
 *   1. ELLE DEFILE. Le bruit qui la deforme court le long de son axe, toujours
 *      dans le meme sens. Une aura qui ondule sur place respire ; une aura qui
 *      defile brule.
 *   2. ELLE A DES POINTES. Une enveloppe lisse est une bulle. Ce sont les
 *      langues qui depassent au bout, plus fines et plus rapides que le corps,
 *      qui donnent la flamme.
 *   3. ELLE SUIT LA COURSE, ELLE NE MONTE PAS.
 *
 *      C'est la correction la plus tardive et la plus evidente une fois vue.
 *      Le premier jet etait une flamme VERTICALE — l'aura de transformation
 *      d'un personnage qui prend racine et pousse son energie vers le ciel.
 *      Sauf qu'ici personne ne prend racine : on file a deux cent vingt a
 *      l'heure vers l'avant. Une flamme verticale sur un corps horizontal ne
 *      dit pas la puissance, elle dit que l'effet a ete pense sans la course.
 *
 *      Elle part donc EN ARRIERE, le long du deplacement reel, relevee d'une
 *      trentaine de degres pour qu'elle se detache du sol et qu'on la voie
 *      passer par-dessus l'epaule. Ce qu'on lit alors n'est plus « il se
 *      transforme » mais « il arrache », ce qui est le sujet du jeu.
 *
 *      L'axe vient du DEPLACEMENT, pas de l'assiette du personnage : le
 *      surfeur pique du nez, se cabre et vrille, son panache ne suit rien de
 *      tout ca. Une flamme collee a l'assiette se lit comme une cape.
 *
 * ---
 *
 * ELLE N'EST PAS DECORATIVE.
 *
 * A pleine puissance elle alimente la LAMPE du personnage (world/RiderLight) :
 * le sol, les brins et l'eau prennent sa couleur sur une dizaine de metres.
 * C'est ce qui la fait exister dans le monde au lieu de flotter devant lui, et
 * c'est aussi ce qui rend les 200 km/h lisibles sans regarder le compteur — la
 * plaine change de couleur.
 *
 * ---
 *
 * Un seul maillage, deux parties, comme les palmiers : l'enveloppe et les
 * langues partagent le meme materiau et le meme appel de rendu. Additif et sans
 * ecriture de profondeur — une aura ne cache rien, elle s'ajoute.
 */

/** Vitesse d'apparition et vitesse de plein regime, en km/h. */
const KMH_START = 200;
const KMH_FULL = 216;

const RINGS = 9;
const SEG = 22;
const BLADES = 9;

function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  /** 0 = enveloppe, 1 = langue. */
  const part: number[] = [];
  /** 0 en bas, 1 en haut. */
  const vv: number[] = [];
  /** Angle azimutal, pour desynchroniser le bruit. */
  const ang: number[] = [];

  const push = (x: number, y: number, z: number, p: number, v: number, a: number): number => {
    pos.push(x, y, z);
    part.push(p);
    vv.push(v);
    ang.push(a);
    return pos.length / 3 - 1;
  };

  // --- L'enveloppe. Profil en GOUTTE INVERSEE : etroite au ras du disque,
  //     large a la taille, puis effilee vers le haut. Un simple cone donnerait
  //     un chapeau, une sphere donnerait une bulle.
  const HEIGHT = 3.0;
  const rows: number[][] = [];
  for (let i = 0; i < RINGS; i++) {
    const v = i / (RINGS - 1);
    const y = -0.35 + v * HEIGHT;
    // Le maximum est a v = 0,22 : au niveau du disque, pas au milieu du buste.
    // 1,85 et non 0,92.
    //
    // Le premier jet donnait a l'enveloppe le rayon du personnage — donc elle
    // etait DANS le personnage. Le buddy est un volume opaque : il masquait sa
    // propre aura, et il n'en depassait qu'un lisere qu'on prenait pour du
    // bloom. Une aura doit envelopper LARGEMENT ce qu'elle entoure, sinon elle
    // n'existe que pour le tampon de profondeur.
    // LE PLANCHER A DISPARU, ET C'EST LUI LE COUPABLE.
    //
    // Le profil valait « 0,42 + 0,58 x rampe » : meme a v = 0, l'enveloppe
    // faisait deja 42 % de sa largeur maximale, c'est-a-dire tout juste le
    // rayon du disque. Elle passait donc DEVANT lui de tous les cotes a la
    // fois, en additif et en blanc. Sans plancher, et avec une rampe en
    // puissance 1,6, la base devient une TIGE — un dixieme du rayon au ras du
    // disque, moitie moins que lui a son plan — et le ventre remonte a la
    // taille du buddy, la ou une flamme de dessin anime a toujours eu son
    // ventre. Le coefficient de tete compense pour que la largeur maximale ne
    // bouge pas.
    const r = 2.30 * Math.pow(Math.max(0, 1 - v), 0.85) * Math.pow(Math.sin(Math.min(1, v / 0.55) * Math.PI * 0.5), 1.6);
    const row: number[] = [];
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      row.push(push(Math.cos(a) * r, y, Math.sin(a) * r, 0, v, a));
    }
    rows.push(row);
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const k = (j + 1) % SEG;
      idx.push(rows[i][j], rows[i][k], rows[i + 1][j]);
      idx.push(rows[i][k], rows[i + 1][k], rows[i + 1][j]);
    }
  }

  // --- Les langues. Plus HAUTES que l'enveloppe et plus fines : ce sont elles
  //     qui depassent, et c'est ce depassement qui fait la flamme.
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + 0.37;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Les langues partent NETTEMENT en dehors du buste : leur travail est
    // d'etre vues, et rien de ce qui passe derriere le personnage n'est vu.
    const base = 1.12;
    // Les langues montent a plus du double de l'enveloppe : ce sont elles qu'on
    // voit depasser, et ce depassement EST la flamme.
    // 3,6 et non 5,2 : les langues sortaient du cadre par le haut, et une
    // flamme dont on ne voit pas la pointe n'est plus une flamme, c'est une
    // colonne.
    const top = 3.6 + (b % 3) * 0.7;
    const w = 0.15;
    const l0 = push(dx * base - dz * w, -0.1, dz * base + dx * w, 1, 0, a);
    const l1 = push(dx * base + dz * w, -0.1, dz * base - dx * w, 1, 0, a);
    const l2 = push(dx * base * 0.30, top, dz * base * 0.30, 1, 1, a);
    idx.push(l0, l1, l2);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  g.setAttribute('aV', new BufferAttribute(new Float32Array(vv), 1));
  g.setAttribute('aAng', new BufferAttribute(new Float32Array(ang), 1));
  g.setIndex(idx);
  return g;
}

export class Aura {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private col = new Color();
  /** 0..1, lisse. Public : le jeu s'en sert pour la lampe et la camera. */
  power = 0;
  /** Axe courant du panache, lisse d'une image a l'autre. */
  private axis = new Vector3(0, 1, 0);
  /**
   * Coefficient de lissage de l'axe pour cette image.
   *
   * Il vient du DELTA DE TEMPS et non d'une constante par image : un lissage
   * a taux fixe converge deux fois plus lentement a trente images par seconde
   * qu'a soixante, et le panache mettrait une seconde a se retourner sur une
   * machine lente. Meme regle que la pose du flou de mouvement.
   */
  private blend = 0.2;

  constructor() {
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPower: { value: 0 },
        uColor: { value: new Color(0x86ff2a) },
        /** Axe du panache, unitaire, en repere MONDE. Vers l'arriere et vers le haut. */
        uAxis: { value: new Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_NOISE}
        attribute float aPart, aV, aAng;
        uniform float uTime, uPower;
        uniform vec3 uAxis;
        varying float vV, vPart, vEdge, vFlick, vLick;

        void main(){
          vV = aV; vPart = aPart;
          vec3 p = position;

          // --- LE DEFILEMENT VERS LE HAUT.
          //
          //     La phase depend de la HAUTEUR moins le temps : le motif remonte
          //     donc la surface au lieu d'osciller sur place. C'est le seul
          //     terme qui separe une flamme d'une bulle qui respire, et il ne
          //     coute rien de plus qu'un signe.
          float flow = aV * 5.4 - uTime * 6.2 + aAng * 1.9;
          float wob = sin(flow) * 0.5 + sin(flow * 1.73 + 1.3) * 0.28;
          vFlick = wob * 0.5 + 0.5;

          // --- LES STRIES.
          //
          //     C'est ce qui manquait au premier jet, et c'est tout le sujet.
          //     Une enveloppe lisse qui monte reste une BULLE lumineuse, quelle
          //     que soit son opacite : le regard n'y trouve aucune structure a
          //     suivre. Une flamme est faite de langues distinctes, et une
          //     modulation en azimut suffit a les creer — sept lobes qui
          //     remontent, decales les uns des autres.
          vLick = pow(0.5 + 0.5 * sin(aAng * 7.0 + flow * 0.75), 1.6);

          // Les langues ondulent DEUX FOIS plus que le corps et se tordent en
          // azimut : sans cette torsion elles restent neuf piquants figes.
          float amp = (aPart > 0.5 ? 0.42 : 0.20) * uPower;
          // L'aura GRANDIT avec la puissance et depasse franchement le
          // personnage : une flamme a la taille du corps se lit comme un
          // contour, pas comme une energie.
          float grow = 0.78 + 0.80 * uPower;
          p.xz *= grow * (1.0 + wob * amp);
          p.y *= grow;
          float tw = wob * (aPart > 0.5 ? 0.30 : 0.10) * aV;
          float ct = cos(tw), st = sin(tw);
          p.xz = mat2(ct, -st, st, ct) * p.xz;

          // Le bord de l'enveloppe est ce qu'on voit : on prepare ici de quoi
          // le faire ressortir au fragment, sans normale ni eclairage.
          vEdge = length(p.xz);

          // --- LE PANACHE SUIT LA COURSE.
          //
          //     La geometrie est batie autour de l'axe Y ; on la REORIENTE ici
          //     sur uAxis, qui pointe vers l'arriere du deplacement et vers le
          //     haut. Le faire dans le shader plutot qu'en tournant l'objet
          //     preserve la regle : la matrice de modele ne porte QUE la
          //     position, donc ni l'assiette ni la vrille du surfeur ne
          //     peuvent s'y glisser par accident.
          //
          //     ET IL EST COURT, ce qui est contre-intuitif. Une flamme
          //     verticale peut mesurer dix metres : elle part vers le ciel, ou
          //     il n'y a rien. Un panache qui part EN ARRIERE part vers la
          //     CAMERA, qui n'est qu'a neuf metres — etire a 1,85 il la
          //     traversait, et tout ce qu'on en voyait etait deux langues qui
          //     montaient hors du cadre. Ce qui ressemblait a un bug de
          //     rotation etait un probleme de LONGUEUR.
          vec3 A = nsafe(uAxis, vec3(0.0, 1.0, 0.0));
          vec3 R = nsafe(cross(vec3(0.0, 1.0, 0.0), A), vec3(1.0, 0.0, 0.0));
          vec3 F = cross(A, R);
          // COURT LE LONG DE L'AXE, LARGE EN TRAVERS. Voir l'evasement juste
          // en dessous : c'est la meme raison.
          p.y *= 0.78;
          p.xz *= 1.05;

          // --- LES LANGUES S'ECARTENT EN FUYANT, et c'est ce qui rend le
          //     panache visible DEPUIS UNE CAMERA DE POURSUITE.
          //
          //     Une camera placee derriere le joueur regarde dans l'axe de la
          //     course : tout ce qui fuit droit vers l'arriere lui arrive PAR
          //     LE BOUT, donc ne mesure plus que sa propre largeur. On peut
          //     coucher le panache autant qu'on veut, il continuera de se lire
          //     comme une tache autour du personnage — c'est un probleme de
          //     point de vue, pas de rotation, et aucune correction d'angle ne
          //     le resout.
          //
          //     Ce qui le resout, c'est l'EVASEMENT : les langues divergent en
          //     s'eloignant au lieu de converger, et on les voit passer de
          //     part et d'autre du personnage. Vu de derriere, ce n'est plus
          //     une flamme qui monte, c'est une couronne qui s'ouvre vers
          //     l'ecran — la lecture exacte de « ca arrache ».
          float fan = 1.0 + aV * aV * (aPart > 0.5 ? 3.6 : 1.35) * uPower;
          p.xz *= fan;
          vec3 o = R * p.x + A * p.y + F * p.z;

          vec4 wp = modelMatrix * vec4(o, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uPower, uTime;
        uniform vec3 uColor;
        varying float vV, vPart, vEdge, vFlick, vLick;

        void main(){
          if (uPower < 0.004) discard;

          // Extinction en hauteur, mais LENTE : a 0,8 la flamme s'eteignait
          // avant d'avoir depasse le personnage, et les langues n'arrivaient
          // jamais jusqu'en haut. Une aura qui ne depasse pas est un contour.
          float up = pow(max(1.0 - vV, 0.0), 0.45);

          // Le coeur est blanc, mais SEULEMENT le coeur. A la puissance 2,6 le
          // blanc mangeait toute la moitie basse et une aura verte ressortait
          // blanche — c'est-a-dire la couleur du personnage qu'on avait
          // justement choisi de rendre visible.
          // Le blanc suit la coupe : cale sur vV = 0 il tombait dans la partie
          // qu'on vient d'effacer, et il ne restait qu'une aura uniformement
          // coloree. Il demarre donc la ou la flamme demarre.
          float heat = pow(clamp(1.0 - (vV - 0.34) / 0.66, 0.0, 1.0), 3.4);
          // 0,26 et non 0,40 : a 0,40 l'aura entiere tirait au blanc et la
          // livree du personnage — la seule chose qu'on voulait montrer — n'y
          // etait plus lisible.
          vec3 c = mix(uColor, vec3(1.0), heat * 0.26);

          float a = up * (0.30 + vFlick * 0.70) * (0.30 + vLick * 0.85);
          a *= vPart > 0.5 ? 1.35 : 0.62;
          a *= uPower;
          // --- LA FLAMME NE COMMENCE QU'AU-DESSUS DE LA MONTURE, ET C'EST UNE
          //     CORRECTION DE BUG.
          //
          //     A [0 ; 0,13] la coupe ne mordait QUE sur les treize premiers
          //     centimetres, alors que l'origine de l'aura est posee quinze
          //     centimetres SOUS le disque : le plan du disque tombait a
          //     vV = 0,17, c'est-a-dire juste apres la coupe, et pile la ou
          //     l'enveloppe est la plus large et le coeur le plus blanc. Au
          //     boost, la monture disparaissait purement et simplement — le
          //     joueur l'a signale comme un bug, et c'en etait un : additif,
          //     x4,3, blanc, exactement sur l'objet qu'on venait de rendre
          //     lisible.
          //
          //     La coupe couvre donc maintenant tout le plan du disque et un
          //     bon tiers au-dessus. La flamme nait a la TAILLE du buddy, ce
          //     qui est aussi ce que fait n'importe quelle aura de dessin
          //     anime : elle enveloppe le corps, pas ses pieds.
          a *= smoothstep(0.14, 0.42, vV);

          // Le liseré. L'enveloppe est vue de l'interieur ET de l'exterieur
          // (DoubleSide) : sans ce renforcement du bord, les deux faces
          // s'additionnent en une masse uniforme.
          a *= 0.5 + 0.9 * smoothstep(0.1, 1.2, vEdge);

          // ALPHA A 1, et toute la modulation dans le RVB.
          //
          // Le melange additif de three.js multiplie la source par son alpha
          // avant de l'ajouter. En sortant l'alpha a la fois dans la couleur et
          // dans l'alpha, on l'appliquait donc DEUX fois : une aura calculee a
          // 0,3 d'intensite arrivait a 0,09 a l'ecran, et aucun reglage de
          // couleur ne pouvait la rattraper. C'est la faute classique de
          // l'additif, et elle se voit d'autant moins qu'elle ne casse rien —
          // elle rend juste tout terne.
          // 3,4 et non 4,3 : a 4,3 la somme saturait si largement que l'aura
          // rendait BLANC partout sauf sur son bord — la couleur de la livree,
          // qui est tout ce qu'elle a a dire, n'arrivait jamais a l'ecran, et
          // la plaine autour disparaissait avec elle.
          gl_FragColor = vec4(c * a * 3.4, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    // Apres le surfeur : l'aura s'ajoute par-dessus lui, elle ne le masque pas.
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
  }

  /**
   * @param kmh vitesse affichee, en km/h
   * @param lamp couleur de la livree du personnage
   * @param dt temps reel, pour le lissage
   */
  update(time: number, kmh: number, lamp: number, dt: number): void {
    const target = Math.min(Math.max((kmh - KMH_START) / (KMH_FULL - KMH_START), 0), 1);
    // Montee franche, extinction plus lente : l'aura doit CLAQUER a
    // l'allumage et trainer un peu apres, comme une inertie thermique. Des
    // vitesses egales dans les deux sens la font clignoter des que la vitesse
    // oscille autour du seuil.
    const rate = target > this.power ? 6.5 : 2.2;
    this.power += (target - this.power) * Math.min(1, dt * rate);
    this.blend = Math.min(1, dt * 9);
    if (this.power < 0.003) this.power = 0;

    this.mesh.visible = this.power > 0;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uPower.value = this.power;
    (this.mat.uniforms.uColor.value as Color).copy(this.col.setHex(lamp));
  }

  /**
   * Pose l'aura sur le surfeur et oriente son panache.
   *
   * La ROTATION du personnage n'est jamais transmise : seul le DEPLACEMENT
   * decide de l'axe. `dx`/`dz` sont la direction de course, normalisee.
   */
  place(p: Vector3, dx: number, dz: number): void {
    this.mesh.position.set(p.x, p.y - 0.15, p.z);

    // Vers l'ARRIERE de la course, releve de trente degres.
    //
    // Le relevement n'est pas cosmetique : a plat, le panache rase le sol et
    // la moitie disparait dedans ; a la verticale on retombe sur la flamme
    // de transformation. Trente degres le font passer par-dessus l'epaule,
    // ce qui est exactement l'endroit ou on le voit sans qu'il masque la
    // route.
    // QUARANTE DEGRES DE COUCHE, ET C'EST UN COMPROMIS DE CADRAGE.
    //
    // Couche a plat, le panache part droit vers la camera : on le voit par le
    // bout, il ne mesure plus que sa propre largeur et il disparait. Dresse a
    // la verticale, on retombe sur la flamme de transformation qu'on vient de
    // coucher. Entre les deux, il y a un angle ou on voit toute sa LONGUEUR
    // en silhouette, au-dessus de l'epaule, sans rien masquer de la route :
    // quarante degres depuis la verticale.
    //
    // C'est la meme lecon que la longueur : ce qui decide de l'effet n'est pas
    // sa formule mais l'endroit d'ou on le regarde. Une camera de poursuite
    // rend end-on tout ce qui fuit dans son axe.
    const LIFT = 1.15;
    let ax = -dx;
    let ay = LIFT;
    let az = -dz;
    const l = Math.hypot(ax, ay, az) || 1;
    ax /= l; ay /= l; az /= l;
    // Lissage : la direction de course sautille au pas de simulation, et un
    // panache qui tremble lit comme un defaut de rendu.
    const a = this.axis;
    const k = this.blend;
    a.x += (ax - a.x) * k;
    a.y += (ay - a.y) * k;
    a.z += (az - a.z) * k;
    const n = a.length() || 1;
    (this.mat.uniforms.uAxis.value as Vector3).set(a.x / n, a.y / n, a.z / n);
  }
}
