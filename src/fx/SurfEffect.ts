import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Matrix4, Uniform, Vector2, Vector3 } from 'three';

/**
 * Tous les effets pilotes par la glisse, fusionnes en un seul passage :
 * flou de mouvement, aberration chromatique, lignes de vitesse, vignette et
 * flash de pop. Les separer couterait quatre lectures de framebuffer pour rien.
 *
 * Le centre est le point de fuite, pas le centre de l'ecran : quand le
 * surfeur carve, tout l'effet de vitesse pivote avec lui.
 *
 * ---
 *
 * LE FLOU DE MOUVEMENT EST UNE REPROJECTION, PAS UN FLOU RADIAL.
 *
 * Le premier jet etirait l'image depuis le point de fuite, proportionnellement
 * a la vitesse affichee. Ca donne le bon effet dans un seul cas — foncer tout
 * droit — et rien du tout dans tous les autres : un virage serre, une camera
 * qui encaisse une reception, un saut, un demi-tour en l'air ne produisaient
 * pas un pixel de flou, alors que ce sont exactement les moments ou l'oeil en
 * attend.
 *
 * On calcule donc la VRAIE vitesse a l'ecran de chaque pixel : on remonte sa
 * position monde depuis la profondeur, on la reprojette avec la matrice de la
 * frame PRECEDENTE, et l'ecart des deux positions ecran est son vecteur
 * vitesse. On floute le long de ce vecteur. C'est la methode standard, elle
 * coute une texture de profondeur et huit echantillons, et elle rend
 * gratuitement tout ce que le flou radial ne savait pas faire : le sol file
 * sous les pieds pendant que l'horizon reste net, le decor balaie l'ecran dans
 * un virage, et le ciel bouge quand la camera tourne.
 *
 * Deux details qui ne se devinent pas :
 *
 *   - LA DUREE D'OBTURATION EST FIXE, PAS LA FRAME. Flouter exactement le
 *     deplacement d'une image donne deux fois plus de flou a trente images par
 *     seconde qu'a soixante — le rendu changerait avec la machine. On rapporte
 *     donc le deplacement a une pose fixe (1/64 s), et le flou devient une
 *     propriete du MONDE et non du debit.
 *   - LE VECTEUR EST BORNE. Une reception qui secoue la camera produit en une
 *     image un deplacement ecran enorme ; sans borne, tout le cadre part en
 *     trainee et l'image devient illisible pile au moment ou le joueur doit
 *     reprendre le controle.
 */
const FRAG = /* glsl */ `
uniform float uSpeed;      // 0..1
uniform float uBoost;      // 0..1
uniform float uCharge;     // 0..1
uniform float uFlash;      // 0..1
uniform vec2  uCenter;     // point de fuite en UV
uniform mat4  uInvVP;      // ecran -> monde, cette image
uniform mat4  uPrevVP;     // monde -> ecran, image precedente
uniform float uMotion;     // force du flou, deja rapportee a la pose
uniform vec2  uFocus;      // le surfeur a l'ecran : le flou l'epargne
uniform float uGrit;       // 0..1 : l'etalonnage sale des mondes couverts
uniform float uTime;       // secondes, pour le grain
uniform vec2  uSunUv;      // le soleil a l'ecran
uniform float uRays;       // 0..1 : force des rayons crepusculaires
uniform vec3  uRayTint;    // couleur de la lumiere du moment
uniform float uAO;         // 0..1 : force de l'occlusion ambiante
uniform float uDof;        // metres : distance de nettete, 0 = desactive
uniform vec2  uTexel;      // taille d'un pixel en UV
uniform vec2  uPlanes;     // near, far de la camera

/**
 * Profondeur LINEAIRE en metres.
 *
 * Le tampon de profondeur est hyperbolique : 90 % de ses valeurs decrivent les
 * dix premiers metres. Comparer deux echantillons bruts ne dit donc rien de la
 * distance qui les separe — c'est la faute qui rend une occlusion ambiante
 * inexploitable, et elle se voit comme un halo sombre autour de tout ce qui est
 * proche.
 */
float metres(float d){
  float n = uPlanes.x;
  float f = uPlanes.y;
  return (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
}

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Douze directions en spirale, generees une fois : un disque de Poisson coute
// une table, une spirale de Fibonacci coute deux lignes et se disperse aussi
// bien. C'est le meme motif qui sert a l'occlusion et a la profondeur de champ.
vec2 spiral(int i, float n, float turns){
  float t = (float(i) + 0.5) / n;
  float a = t * turns;
  return vec2(cos(a), sin(a)) * sqrt(t);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor){
  vec2 dir = uv - uCenter;
  float dist = length(dir);
  vec3 col = inputColor.rgb;
  float zm = metres(depth);

  // --- L'OCCLUSION AMBIANTE, ET C'EST ELLE QUI POSE TOUT LE RESTE.
  //
  //     Le jeu n'a aucune ombre portee en dehors de celle du surfeur : chaque
  //     objet — une maison, un brin, le pied d'une balise — flotte sur le sol
  //     avec exactement la meme valeur que lui. C'est le defaut le plus couteux
  //     du rendu, et le moins cher a corriger : la ou deux surfaces se
  //     rencontrent, la lumiere du ciel arrive moins bien, donc c'est plus
  //     sombre. Rien d'autre.
  //
  //     La version ici est une AO d'horizon a six echantillons : on regarde si
  //     les voisins sont PLUS PRES de la camera que le pixel courant. S'ils le
  //     sont, ils lui cachent une partie du ciel.
  //
  //     Le rayon est en METRES et converti en pixels par la profondeur, pas
  //     l'inverse : un rayon fixe en UV donnerait une AO large au loin et
  //     invisible sous les pieds, ce qui est le contraire de ce qu'on veut.
  if (uAO > 0.002 && zm < 240.0) {
    float radius = clamp(0.55 / max(zm, 1.0), 0.0015, 0.045);
    float occ = 0.0;
    for (int i = 0; i < 6; i++) {
      vec2 o = spiral(i, 6.0, 14.0) * radius;
      float dz = zm - metres(readDepth(uv + o));
      // Un voisin plus proche occulte, mais SEULEMENT s'il est proche en
      // profondeur : au-dela d'un metre et demi ce n'est plus un pli, c'est un
      // objet devant, et l'assombrir dessinerait un contour noir autour de
      // tout — le halo qui trahit une AO mal bornee.
      occ += smoothstep(0.04, 0.55, dz) * (1.0 - smoothstep(1.2, 2.6, dz));
    }
    occ /= 6.0;
    // Elle s'efface au loin, la ou le pli passe sous le pixel et ou l'AO ne
    // produit plus que du scintillement.
    occ *= uAO * (1.0 - smoothstep(90.0, 230.0, zm));
    // On assombrit en TEINTANT vers l'ombre du ciel, pas vers le noir : une
    // occlusion grise sur un monde colore le desature, et c'est ce qui donne
    // l'aspect « sale » des AO posees a la va-vite.
    col *= mix(vec3(1.0), vec3(0.62, 0.68, 0.80), occ);
  }

  // --- LE FLOU DE MOUVEMENT.
  //
  //     On remonte la position monde du pixel depuis sa profondeur, on la
  //     reprojette avec la matrice de l'image precedente, et l'ecart des deux
  //     positions ecran EST son vecteur vitesse.
  //
  //     Le ciel a une profondeur de 1 : sa position monde tombe sur le plan
  //     lointain, ce qui est exact — il ne bouge pas quand on avance, il bouge
  //     quand on TOURNE, et c'est precisement ce que la reprojection rend.
  if (uMotion > 0.001) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 wp = uInvVP * ndc;
    if (abs(wp.w) > 1e-6) {
      wp /= wp.w;
      vec4 pp = uPrevVP * wp;
      if (abs(pp.w) > 1e-6) {
        vec2 vel = (uv - (pp.xy / pp.w * 0.5 + 0.5)) * uMotion;
        // --- LE SURFEUR RESTE NET, ET CE N'EST PAS UNE FACILITE.
        //
        //     Un flou par reprojection ne connait que la camera : il floute
        //     tout ce qui bouge PAR RAPPORT A ELLE, donc aussi le personnage,
        //     qui pourtant ne bouge pas d'un pixel a l'ecran. Sans correction
        //     il part en bouillie des qu'on carve — c'est-a-dire pile quand on
        //     a besoin de le voir.
        //
        //     On epargne donc un disque autour de sa position ecran. C'est
        //     aussi ce que fait n'importe quel jeu de course avec sa voiture,
        //     et pour une deuxieme raison qui vaut a elle seule : le point que
        //     l'oeil suit doit rester le point NET de l'image.
        vel *= smoothstep(0.06, 0.33, distance(uv, uFocus));
        // Borne : une reception secoue la camera assez fort pour etirer tout
        // le cadre en une image, et une image illisible au moment de reprendre
        // le controle est pire que pas de flou du tout.
        float m = length(vel);
        if (m > 0.030) vel *= 0.030 / m;
        if (m > 0.0004) {
          // Echantillonnage CENTRE sur le pixel : de -0,5 a +0,5 du vecteur.
          // Tire d'un seul cote, le flou DEPLACE l'image au lieu de l'etaler,
          // et tout le cadre glisse d'un demi-vecteur — ce qui se lit comme
          // un decalage de synchronisation, pas comme de la vitesse.
          vec3 acc = col;
          for (int i = 1; i < 6; i++) {
            float t = float(i) / 5.0 - 0.5;
            acc += texture2D(inputBuffer, uv + vel * t).rgb;
          }
          col = acc / 6.0;
        }
      }
    }
  }

  // --- LA PROFONDEUR DE CHAMP.
  //
  //     Une image entierement nette est une image de logiciel de CAO : aucun
  //     objectif ne fait ca, et l'oeil le sait sans savoir pourquoi. Un leger
  //     flou au-dela du plan de nettete suffit a faire basculer le rendu du
  //     cote « photographie », et il fait un second travail, plus important :
  //     il HIERARCHISE. Le surfeur et la porte restent nets, l'horizon fond.
  //
  //     Le plan de nettete est la distance du SURFEUR, pas une constante : la
  //     camera vit sur des ressorts et recule au boost, un plan fixe ferait
  //     respirer le flou a chaque acceleration.
  //
  //     Seulement le LOINTAIN, jamais le premier plan. Un flou d'avant-plan est
  //     l'effet le plus cher a bien faire — il demande de savoir ce qu'il y a
  //     DERRIERE ce qu'on floute — et fait immediatement du sale quand on le
  //     bricole en espace ecran. Le sol qui defile sous les pieds est deja
  //     traite par le flou de mouvement, qui est le bon outil pour lui.
  if (uDof > 0.5 && zm > 90.0) {
    // EN METRES ABSOLUS, PAS EN MULTIPLES DU PLAN DE NETTETE. Le plan est a une
    // dizaine de metres — le surfeur — donc un flou qui demarrerait a « une
    // fois et demie le plan » commencerait a quinze metres et noierait tout le
    // paysage des le premier plan. Ce qu'on veut flouter, c'est l'HORIZON.
    float coc = smoothstep(120.0, 620.0, zm) * 0.55;
    if (coc > 0.02) {
      float r = coc * 0.0055;
      vec3 acc = col;
      for (int i = 0; i < 6; i++) {
        vec2 o = spiral(i, 6.0, 11.0) * r;
        acc += texture2D(inputBuffer, uv + o).rgb;
      }
      col = mix(col, acc / 7.0, coc);
    }
  }

  // --- LES RAYONS CREPUSCULAIRES.
  //
  //     C'est l'effet qui separe le plus nettement « un ciel avec un soleil
  //     dessine dedans » de « une scene eclairee par un soleil ». On accumule
  //     la couleur de l'image le long du rayon qui va du pixel vers le soleil,
  //     et on ne garde que ce qui vient du CIEL : les pixels de decor sont
  //     rejetes par la profondeur. Ce qui reste, ce sont les trainees de
  //     lumiere qui passent A COTE d'un nuage, d'une colline ou d'une maison —
  //     donc exactement les rayons qu'on voit dans la realite, et pour la meme
  //     raison physique.
  //
  //     Le masque de profondeur est ce qui fait tout : sans lui, la couleur du
  //     decor se met a bavez vers le soleil et l'image se met a couler.
  if (uRays > 0.004) {
    vec2 toSun = uSunUv - uv;
    float far = length(toSun);
    // Au-dela d'un ecran et demi, le soleil est trop loin pour que les rayons
    // aient un sens : on ne va pas chercher de la lumiere hors du cadre.
    float reach = 1.0 - smoothstep(0.55, 1.30, far);
    if (reach > 0.01) {
      vec3 shaft = vec3(0.0);
      float wsum = 0.0;
      for (int i = 1; i <= 10; i++) {
        float t = float(i) / 10.0;
        vec2 p = uv + toSun * t * 0.72;
        // Le poids decroit : la lumiere se disperse en s'eloignant de sa
        // source. Une somme a poids constant donne une bouillie uniforme.
        float w = (1.0 - t) * (1.0 - t);
        // Seul le ciel emet. readDepth rend 1 sur le fond, et on prend une
        // marge : un pixel de nuage tres lointain compte aussi.
        float sky = smoothstep(0.9985, 0.99999, readDepth(p));
        shaft += texture2D(inputBuffer, p).rgb * sky * w;
        wsum += w;
      }
      shaft /= max(wsum, 1e-4);
      // --- DEUX MASQUES, ET SANS EUX C'EST UN OEUF BLANC AU MILIEU DU CADRE.
      //
      //     1. LE COEUR NE RAYONNE PAS. Tout pres du soleil, les dix
      //        echantillons tombent au meme endroit : on n'accumule plus une
      //        trainee, on recopie dix fois le meme pixel brillant, et le
      //        resultat est une ELLIPSE OPAQUE de trois cents pixels. C'est
      //        exactement ce qu'a donne le premier jet. Le halo du soleil est
      //        deja dessine par le ciel, avec ses branches et sa couronne ; ce
      //        que la passe doit ajouter, c'est ce qui se passe A COTE.
      float core = smoothstep(0.035, 0.24, far);
      //     2. LES RAYONS SE VOIENT SUR CE QU'ILS ECLAIRENT. Sur le ciel, le
      //        faisceau se superpose a la couleur qu'il vient d'echantillonner
      //        et ne fait que doubler la luminosite d'un aplat deja clair. Sur
      //        le DECOR, il lit comme de la lumiere qui deborde par-dessus une
      //        colline — le seul endroit ou l'oeil accepte de le voir.
      float onSky = smoothstep(0.9985, 0.99999, depth);
      col += shaft * uRayTint * uRays * reach * core * mix(1.0, 0.30, onSky);
    }
  }

  // --- Aberration chromatique : au repos elle doit etre presque invisible.
  float ca = (0.0006 + uSpeed * 0.0010 + uBoost * 0.0029 + uFlash * 0.0035) * (0.35 + dist);
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

  // --- Vignette douce.
  col *= 1.0 - smoothstep(0.42, 1.05, dist) * (0.28 + uGrit * 0.30);

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

  // --- L'ETALONNAGE SALE, ET IL NE SUFFIT PAS D'ASSOMBRIR.
  //
  //     Un monde couvert etalonne comme un monde ensoleille reste une image de
  //     beau temps qu'on a baissee. Ce qui fait le grungecore, ce sont quatre
  //     choses precises, et aucune n'est « plus sombre » :
  //
  //       1. LA SATURATION TOMBE, sauf sur les sources. Sous un plafond il n'y
  //          a plus de lumiere coloree ; la seule couleur qui reste est celle
  //          des choses qui BRILLENT — les fenetres, les lampadaires, le
  //          personnage. On desature donc en preservant ce qui est deja clair.
  //       2. LES NOIRS SE LEVENT ET SE REFROIDISSENT. Le noir profond est une
  //          image de nuit claire ; sous la pluie l'air diffuse et les ombres
  //          remontent, en bleu-vert. C'est le « lifted black » de la
  //          photo argentique poussee, et c'est LE marqueur du genre.
  //       3. LE HAUT DU CADRE EST PLUS LOURD QUE LE BAS. Un plafond pese. Une
  //          vignette symetrique donne un vieux film, pas un ciel bas.
  //       4. LE GRAIN. Pas du bruit propre : un grain lie a la LUMINANCE, plus
  //          present dans les demi-tons que dans les hautes lumieres, comme
  //          une pellicule sous-exposee qu'on a poussee au developpement.
  if (uGrit > 0.002) {
    float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(0.35, 0.95, l2);
    col = mix(mix(vec3(l2), col, 0.54 + keep * 0.42), col, 1.0 - uGrit);
    // Le relevement des noirs se dose au MILLIEME. A 0,030 il ne relevait pas
    // les ombres, il effacait la route : l'asphalte mouille, qui est le sujet
    // du monde, remontait au gris moyen et l'image entiere devenait laiteuse.
    vec3 lift = mix(col, col * 0.94 + vec3(0.013, 0.019, 0.021),
                    1.0 - smoothstep(0.0, 0.30, l2));
    col = mix(col, lift, uGrit);
    // Le poids du plafond : le haut du cadre s'assombrit, le bas non.
    col *= 1.0 - uGrit * 0.20 * smoothstep(0.45, 1.0, 1.0 - uv.y);
    float g = hash12(floor(uv * 620.0) + floor(uTime * 24.0));
    col += (g - 0.5) * uGrit * 0.055 * (0.35 + (1.0 - abs(l2 * 2.0 - 1.0)));
  }

  // --- LA COURBE FILMIQUE, EN DERNIER.
  //
  //     Le rendu passe deja par un tonemap neutre au niveau des materiaux :
  //     celui-la fait son travail, qui est de ramener une plage dynamique dans
  //     l'ecran sans rien casser. Ce qu'il ne fait pas, c'est ce qu'une
  //     pellicule fait — un PIED qui ecrase doucement les noirs et une EPAULE
  //     qui retient les hautes lumieres au lieu de les couper net.
  //
  //     C'est la difference entre une image « exposee » et une image
  //     « etalonnee », et elle se voit surtout sur les deux extremes : le ciel
  //     pres du soleil cesse d'etre un aplat blanc, et les ombres du sol
  //     cessent d'etre un aplat sombre.
  //
  //     Elle vient APRES tout le reste, y compris les rayons et le grain :
  //     c'est l'etage de sortie, et tout ce qui passe devant elle doit etre
  //     traite comme de la lumiere, pas comme des pixels.
  {
    vec3 k = max(col, 0.0);
    // Epaule : x/(x+1) renormalise pour que le blanc reste blanc. Sans la
    // renormalisation, tout le rendu perd 20 % de luminosite d'un coup.
    const float W = 1.28;
    vec3 sh = k * (1.0 + k / (W * W)) / (1.0 + k);
    // Pied : un leger contraste en S sur les valeurs basses. Applique sur
    // TOUTE la plage il ecraserait les demi-tons, qui sont l'essentiel de
    // l'image dans un jeu aussi clair que celui-la.
    vec3 lo = sh * sh * (3.0 - 2.0 * sh);
    col = mix(sh, lo, 0.22 * (1.0 - smoothstep(0.35, 0.85, dot(sh, vec3(0.2126, 0.7152, 0.0722)))));
  }

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
  /** Matrice monde -> ecran de l'image precedente. */
  private prevVP = new Matrix4();
  /** Reutilisee a chaque image pour ne rien allouer dans la boucle de rendu. */
  private vp = new Matrix4();
  /** Vraie des la deuxieme image : avant, prevVP ne veut rien dire. */
  private primed = false;

  constructor() {
    super('SurfEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      // La profondeur, et c'est elle qui rend le flou de mouvement possible :
      // sans position monde par pixel, on ne peut que deviner un flou radial.
      // Le compositeur cree la texture tout seul des qu'un effet la demande.
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uSpeed', new Uniform(0)],
        ['uBoost', new Uniform(0)],
        ['uCharge', new Uniform(0)],
        ['uFlash', new Uniform(0)],
        ['uCenter', new Uniform(new Vector2(0.5, 0.5))],
        ['uFocus', new Uniform(new Vector2(0.5, 0.42))],
        ['uInvVP', new Uniform(new Matrix4())],
        ['uPrevVP', new Uniform(new Matrix4())],
        ['uMotion', new Uniform(0)],
        ['uGrit', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uSunUv', new Uniform(new Vector2(0.5, 0.8))],
        ['uRays', new Uniform(0)],
        ['uRayTint', new Uniform(new Vector3(1, 0.96, 0.86))],
        ['uAO', new Uniform(0.85)],
        ['uDof', new Uniform(0)],
        ['uTexel', new Uniform(new Vector2(1 / 1280, 1 / 720))],
        ['uPlanes', new Uniform(new Vector2(0.1, 4000))],
      ]),
    });
  }

  /**
   * Enregistre le point de vue de cette image et prepare la reprojection.
   *
   * @param dt duree reelle de l'image, en secondes
   * @param gain 0..1, dose globale du flou
   */
  camera(proj: Matrix4, viewInv: Matrix4, dt: number, gain: number): void {
    const u = this.uniforms;
    this.vp.multiplyMatrices(proj, viewInv);
    (u.get('uInvVP')!.value as Matrix4).copy(this.vp).invert();
    (u.get('uPrevVP')!.value as Matrix4).copy(this.primed ? this.prevVP : this.vp);

    // POSE FIXE, ET PAS LA DUREE DE L'IMAGE.
    //
    // Flouter le deplacement d'une image donnerait deux fois plus de flou a
    // trente images par seconde qu'a soixante : l'image changerait avec la
    // machine. On rapporte le deplacement a une obturation de 1/64 s, et le
    // flou redevient une propriete du monde. Borne a 2 pour qu'un a-coup
    // (onglet en arriere-plan, premiere image) ne parte pas en trainee.
    const SHUTTER = 1 / 64;
    const scale = Math.min(2, SHUTTER / Math.max(dt, 1e-4));
    u.get('uMotion')!.value = this.primed ? gain * scale : 0;

    this.prevVP.copy(this.vp);
    this.primed = true;
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

  /** Ou se trouve le surfeur a l'ecran : le flou de mouvement l'epargne. */
  focus(x: number, y: number): void {
    (this.uniforms.get('uFocus')!.value as Vector2).set(safe(x), safe(y));
  }

  /** L'etalonnage sale des mondes couverts, et l'horloge du grain. */
  grit(amount: number, time: number): void {
    this.uniforms.get('uGrit')!.value = Math.min(1, Math.max(0, amount));
    this.uniforms.get('uTime')!.value = time % 1000;
  }

  /**
   * Le soleil a l'ecran, et la force des rayons.
   *
   * `visible` doit deja tenir compte du fait que le soleil est DERRIERE la
   * camera : projeter un point derriere le plan proche rend une position
   * miroir parfaitement plausible, et les rayons partiraient du mauvais cote
   * de l'ecran sans que rien ne signale l'erreur.
   */
  sun(x: number, y: number, strength: number, r: number, g: number, b: number): void {
    const u = this.uniforms;
    (u.get('uSunUv')!.value as Vector2).set(safe(x), safe(y));
    u.get('uRays')!.value = Math.max(0, Math.min(1, strength));
    (u.get('uRayTint')!.value as Vector3).set(r, g, b);
  }

  /** Les deux reglages qui dependent de la camera : plans et plan de nettete. */
  optics(near: number, far: number, focusMetres: number, ao: number): void {
    const u = this.uniforms;
    (u.get('uPlanes')!.value as Vector2).set(near, far);
    u.get('uDof')!.value = focusMetres;
    u.get('uAO')!.value = ao;
  }

}
