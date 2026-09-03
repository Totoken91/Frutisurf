import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { GLSL_SAFE, GLSL_NOISE } from '../core/Noise';
import { colClone, vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { swellGLSL, terrainGLSL, terrainUniforms } from './Terrain';
import { WEATHER_GLSL } from './Weather';

/**
 * Les etendues d'eau.
 *
 * Aucun lac n'est place a la main. Il y a un NIVEAU, et l'eau remplit tout ce
 * que le relief laisse en dessous : la surface est un plan parfaitement plat,
 * decoupe au `discard` la ou le terrain repasse au-dessus. Les rives suivent
 * donc les courbes de niveau, elles sont organiques et toutes differentes,
 * pour le prix d'une constante.
 *
 * La geometrie est la MEME grille en eventail que le sol, a plat. Elle est
 * dense la ou on la regarde de pres et lache au loin, exactement la ou il faut,
 * et elle suit le joueur par les memes pas entiers de maille.
 *
 * Le rendu vise le Frutiger Aero litteral : turquoise sature, fond visible en
 * eau peu profonde, ciel reflechi a l'incidence rasante, et surtout des
 * PAILLETTES de soleil. Ce sont elles qui font l'eau ; une surface lisse et
 * bleue ne fait qu'un plastique bleu.
 */

const SNAP = 1.2;
const Z_START = 45;
const Z_END = -1800;

function buildGeometry(dense: boolean): BufferGeometry {
  const rows: number[] = [];
  let z = Z_START;
  let step = dense ? SNAP * 2 : SNAP * 3.5;
  while (z > Z_END) {
    rows.push(z);
    z -= step;
    if (z < -120) step = Math.min(step * (dense ? 1.06 : 1.09), 80);
  }
  rows.push(Z_END);

  const cols = dense ? 90 : 56;
  const R = rows.length;
  const pos = new Float32Array(R * cols * 3);
  const idx: number[] = [];
  for (let i = 0; i < R; i++) {
    const zz = rows[i];
    const half = 80 + 1.35 * (Z_START - zz);
    for (let j = 0; j < cols; j++) {
      const t = j / (cols - 1);
      const o = (i * cols + j) * 3;
      pos[o] = (t - 0.5) * 2 * half;
      pos[o + 1] = 0;
      pos[o + 2] = zz;
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Water {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;

  constructor(dense = true) {
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: {
        ...riderUniforms(),
        // Le relief est pilote par uniformes : changer de monde ne recompile
        // aucun shader (cf. Terrain.terrainGLSL).
        ...terrainUniforms(),
        uTime: { value: 0 },
        uCam: { value: new Vector3() },
        uOrigin: { value: new Vector3() },
        uSun: { value: SUN_DIR.clone() },
        uDeep: { value: vec3('waterDeep') },
        uShallow: { value: vec3('waterShallow') },
        uFoam: { value: vec3('waterFoam') },
        uSkyLow: { value: colClone('skyHorizon') },
        uSkyHigh: { value: colClone('skyMid') },
        uSkyLight: { value: [0.32, 0.52, 0.72] },
        ...dayUniforms(),
        /** x, z du surfeur et force du sillage (0 hors de l'eau). */
        uWake: { value: new Vector3() },
        /**
         * 0 = surface calme, 1 = sous l'averse.
         *
         * La pluie fait a l'eau l'inverse de ce qu'elle fait au sol : le sol
         * gagne un miroir, l'eau le PERD. Une surface crevee de gouttes est
         * une surface rugueuse — elle diffuse au lieu de reflechir, ses
         * paillettes s'eteignent, et c'est cette perte de brillance qui rend
         * un etang d'octobre si mat.
         */
        uRain: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uOrigin;
        uniform float uTime;
        varying vec3 vWorld;
        varying float vDepth;
        /** Pente de la houle, transmise au fragment pour la normale. */
        varying vec2 vSwellSlope;
        /**
         * Hauteur normalisee de la vague, -1 en creux, +1 en crete.
         *
         * Passee en varying plutot que recalculee au fragment : la houle est
         * une fonction lisse a grande echelle, l'interpoler sur un triangle ne
         * coute aucune qualite, et l'evaluer par pixel paierait deux sinus pour
         * une valeur qui ne change quasiment pas sur la surface d'un triangle.
         */
        varying float vCrest;

        ${terrainGLSL()}
${swellGLSL()}

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          wp.y = WATER_LEVEL;
          float d = length(wp.xz - uOrigin.xz);
          // La profondeur est calculee ICI et interpolee : la decoupe de rive
          // se fait ensuite au fragment sur cette valeur lissee, ce qui donne
          // un bord net mais pas cranele par la grille.
          vDepth = WATER_LEVEL - terrainHeightAt(wp.xz, d);

          // --- LA HOULE, deplacee au sommet.
          //
          //     La MEME fonction que celle du Controller, au meme instant : le
          //     surfeur plane a la hauteur que calcule le processeur, la vague
          //     est dessinee a la hauteur que calcule la carte graphique. Un
          //     ecart de signe le ferait surfer dans les creux, un ecart
          //     d'amplitude le ferait flotter au-dessus de l'eau.
          float shoal = swellShoal(vDepth);
          float sw = swellAt(wp.xz, uTime);
          wp.y += sw * shoal;
          vCrest = uSwell.x > 0.0 ? sw / uSwell.x : 0.0;

          // La pente de la vague, par differences finies sur quelques metres.
          // Sans elle la houle serait une deformation SANS ombre : la surface
          // monterait et descendrait sans qu'aucune lumiere ne le dise, et on
          // ne verrait rien du tout.
          float e = 2.5;
          vSwellSlope = vec2(
            swellAt(wp.xz + vec2(e, 0.0), uTime) - swellAt(wp.xz - vec2(e, 0.0), uTime),
            swellAt(wp.xz + vec2(0.0, e), uTime) - swellAt(wp.xz - vec2(0.0, e), uTime)
          ) * (shoal / (2.0 * e));

          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uTime;
        uniform vec3 uCam, uSun, uDeep, uShallow, uFoam, uSkyLow, uSkyHigh, uSkyLight, uWake;
        uniform float uRain;
${GLSL_DAY}
        varying vec3 vWorld;
        varying float vDepth;
        varying vec2 vSwellSlope;
        varying float vCrest;
        uniform vec3 uSwell;
${RIDER_GLSL}

        ${GLSL_NOISE}
        ${WEATHER_GLSL}

        void main(){
          // Hors de l'eau : rien. C'est ce discard qui dessine les rives.
          if (vDepth <= 0.02) discard;

          vec3 V = nsafe(uCam - vWorld, vec3(0.0, 1.0, 0.0));
          vec3 L = normalize(uSun);

          // --- La ride. Deux couches de bruit qui derivent en sens contraire :
          //     une seule donnerait un motif qui glisse en bloc, et l'oeil lit
          //     tout de suite une texture qu'on translate.
          vec2 p = vec2(vWorld.x, mod(vWorld.z, 1000.0));
          vec2 a = p * 0.38 + vec2(uTime * 0.22, uTime * 0.14);
          vec2 b = p * 0.83 - vec2(uTime * 0.17, uTime * 0.31);
          float h1 = fbm(a);
          float h2 = fbm(b);
          // Normale par differences finies sur le champ de rides.
          float e = 0.06;
          float hx = fbm(a + vec2(e, 0.0)) * 0.6 + fbm(b + vec2(e, 0.0)) * 0.4;
          float hz = fbm(a + vec2(0.0, e)) * 0.6 + fbm(b + vec2(0.0, e)) * 0.4;
          float h0 = h1 * 0.6 + h2 * 0.4;
          // --- SILLAGE. Il n'y a pas de glisse sans trace. C'est lui qui dit
          //     que le disque PORTE sur l'eau au lieu de la traverser, et c'est
          //     le seul retour qui reste visible quand la camera est basse.
          //     Deux branches en V ouvertes a ~20 degres, plus le remous
          //     central juste derriere le disque.
          vec2 rel = vWorld.xz - uWake.xy;
          float back = rel.y; // le joueur avance en -Z : derriere lui, c'est +Z
          float wake = 0.0;
          if (uWake.z > 0.001 && back > -1.0 && back < 90.0) {
            float bb = max(back, 0.0);
            float arm = abs(abs(rel.x) - bb * 0.36);
            float fade = 1.0 - bb / 90.0;
            wake = exp(-arm * arm * 1.1) * fade * fade;
            wake += exp(-rel.x * rel.x * 0.30) * exp(-bb * 0.20) * 0.85;
            wake *= uWake.z;
          }

          // Les rides s'aplatissent en eau peu profonde, comme dans la nature —
          // mais elles ne DISPARAISSENT pas, et c'est la nuance qui manquait.
          // A amplitude nulle la surface devient un plan parfait : tous ses
          // pixels renvoient le soleil en meme temps, et le haut-fond partait
          // en tache blanche pleine pendant que le large scintillait
          // normalement. Un fond de vingt centimetres a encore des rides ; il
          // les a seulement plus courtes.
          float amp = 1.5 * (0.34 + 0.66 * smoothstep(0.0, 1.6, vDepth));
          vec3 N = normalize(vec3((h0 - hx) * amp, 0.09, (h0 - hz) * amp));
          // La houle incline la normale a GRANDE echelle : c'est ce qui donne
          // aux flancs de vague leur ombre et a leurs cretes leur reflet, donc
          // ce qui rend le relief de l'ocean lisible de loin.
          N = normalize(N + vec3(-vSwellSlope.x, 0.0, -vSwellSlope.y) * 2.2);
          // Le sillage BOMBE la surface : il doit accrocher la lumiere, sinon
          // ce n'est qu'une trainee blanche peinte sur l'eau.
          N = normalize(N + vec3(sign(rel.x) * wake * 0.55, 0.0, -wake * 0.35));

          // --- LA MICRO-RIDE, la plus courte de toutes, et elle n'existe que
          //     pour casser la coherence du speculaire. Une nappe d'eau dont
          //     toutes les facettes pointent au meme endroit n'est pas de
          //     l'eau, c'est un miroir — et un miroir face au soleil ne rend
          //     qu'un aplat blanc.
          {
            vec2 m = p * 7.3 + vec2(uTime * 0.55, -uTime * 0.41);
            float mx = fbm(m + vec2(0.05, 0.0)) - fbm(m);
            float mz = fbm(m + vec2(0.0, 0.05)) - fbm(m);
            N = normalize(N + vec3(mx, 0.0, mz) * 2.6);
          }

          // --- LA PLUIE CREVE LA SURFACE.
          //
          //     Les memes anneaux d'impact que ceux des flaques du sol (cf.
          //     Weather.rainRings) : ce qui tombe sur l'herbe et ce qui tombe
          //     dans l'etang doivent etre la meme averse, au metre pres. On les
          //     eteint au loin, ou l'anneau passe sous le pixel et ne produit
          //     plus que du scintillement.
          float rainNear = uRain * (1.0 - smoothstep(20.0, 85.0, length(vWorld.xz - uCam.xz)));
          if (rainNear > 0.004) {
            float e2 = 0.09;
            // DEUX echelles d'impact, comme il y a deux trains de houle : une
            // seule donne une trame reguliere que l'oeil lit comme un motif.
            // Sous une averse forte, la surface n'a plus de rythme du tout.
            float r0 = rainRings(vWorld.xz, uTime)
                     + rainRings(vWorld.xz * 1.9 + 5.7, uTime * 1.27) * 0.7;
            float rx = rainRings(vWorld.xz + vec2(e2, 0.0), uTime)
                     + rainRings((vWorld.xz + vec2(e2, 0.0)) * 1.9 + 5.7, uTime * 1.27) * 0.7;
            float rz = rainRings(vWorld.xz + vec2(0.0, e2), uTime)
                     + rainRings((vWorld.xz + vec2(0.0, e2)) * 1.9 + 5.7, uTime * 1.27) * 0.7;
            N = normalize(N + vec3((r0 - rx), 0.0, (r0 - rz)) * rainNear * 0.85);
          }

          // --- LE CORPS DE L'EAU, et lui seul, recoit l'heure.
          //
          //     C'est ici que le crepuscule tournait mal. La couleur finale —
          //     corps ET reflet du ciel confondus — passait dans daylight()
          //     tout a la fin, donc le reflet du ciel etait teinte une SECONDE
          //     fois par la lumiere. Un cyan sature multiplie par un orange
          //     sature ne donne ni du cyan ni de l'orange : ca donne un gris
          //     verdatre, et le lac devenait de la boue exactement au moment ou
          //     il aurait du etre le plus beau.
          float t = smoothstep(0.15, 4.6, vDepth);
          vec3 body = mix(uShallow, uDeep, t);
          body = daylight(body, 0.30 + uDayNight * 0.34);

          // --- Le reflet, lui, est DEJA a la couleur du ciel : on n'y touche
          //     plus.
          float fres = pow(max(1.0 - clamp(dot(N, V), 0.0, 1.0), 1e-4), 4.0);
          // --- LE CIEL SE LIT SUR LE RAYON REFLECHI, PAS SUR LE REGARD, ET
          //     C'EST TOUTE LA TEXTURE DE L'EAU LOINTAINE.
          //
          //     Indexe sur V.y, le reflet ne depend que de la DISTANCE : toute
          //     l'eau au-dela de vingt metres renvoyait la meme valeur, celle
          //     du bas du ciel, c'est-a-dire un blanc uniforme.
          //
          //     Indexe sur le rayon reflechi, il depend de la RIDE : deux
          //     pixels voisins renvoient l'un le bas du ciel, l'autre son
          //     azur, et la nappe lointaine retrouve un grain. C'est aussi ce
          //     que fait la vraie eau, ce qui est en general bon signe.
          //
          //     ET LE CIEL REFLECHI EST PLUS SOMBRE QUE LE CIEL, parce qu'une
          //     surface d'eau ne renvoie jamais cent pour cent de ce qu'elle
          //     recoit : ce qui n'est pas renvoye part dans la masse. A pleine
          //     valeur, la nappe lointaine rendait exactement la bande basse du
          //     ciel — un blanc — et se collait a lui au lieu de s'en detacher.
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyLow, uSkyHigh, clamp(R.y * 2.4, 0.0, 1.0)) * 0.80;

          // Plus le soleil est bas, plus l'eau devient un MIROIR. C'est toute
          // la difference entre un lac de midi, qui a une couleur propre, et un
          // lac de couchant, qui n'a plus que des reflets. Sans ce terme, une
          // eau turquoise reste turquoise sous un ciel de braise — ce que la
          // physique interdit et ce que l'oeil repere immediatement.
          float mirror = clamp(fres * (1.15 + uDayWarm * 1.45), 0.0, 0.82);
          vec3 c = mix(body, sky, mirror);

          // L'ecume du sillage AVANT les paillettes : posee apres, elle les
          // effacait et le sillage devenait une bande de peinture blanche
          // mate au milieu d'une eau qui scintille partout ailleurs.
          vec3 foamCol = daylight(uFoam, 0.18 + uDayNight * 0.42);
          c = mix(c, foamCol, clamp(wake * 0.78, 0.0, 0.82));

          // --- PAILLETTES. Le detail qui fait l'eau, et il faut qu'il soit
          //     dur : un speculaire large donne du satin, c'est une multitude
          //     de points nets qui donne une surface liquide au soleil.
          vec3 H = normalize(V + L);
          float ndh = max(dot(N, H), 0.0);
          // Exposant 340 : c'est le pow le plus violent du projet. En mediump,
          // n * log2(x) perd toute precision utile bien avant d'atteindre ce
          // rang, et a ndh = 0 il produit un NaN qui, additionne a la couleur,
          // rend le pixel noir puis contamine le flou de bloom.
          float ndhs = max(ndh, 1e-4);
          // Sous l'averse, la paillette MEURT : une surface crevee de gouttes
          // n'a plus de facette assez large pour renvoyer le soleil d'un bloc.
          // --- LE CHAMP DE FACETTES, ET C'EST LUI QUI FAIT LA DIFFERENCE
          //     ENTRE UN CHEMIN DE LUMIERE ET UNE TACHE BLANCHE.
          //
          //     Le lobe large (exposant 46) couvrait a lui seul un bon tiers du
          //     cadre des que le soleil passait bas : une nappe blanche pleine,
          //     que le bloom achevait d'etaler. Or un chemin de lumiere sur
          //     l'eau n'est PAS une nappe — c'est une multitude de facettes
          //     dont seules quelques-unes sont orientees vers l'oeil a un
          //     instant donne, et c'est leur clignotement qui fait le liquide.
          //
          //     On serre donc le lobe large, et on module le lobe dur par un
          //     champ de bruit rapide : la paillette ne s'allume plus que la ou
          //     la facette existe, et le chemin redevient granuleux.
          //     ET LE CHAMP MODULE LES DEUX LOBES, PAS SEULEMENT LE DUR.
          //
          //     Premiere tentative : seul le lobe dur etait module. Le chemin
          //     redevenait granuleux au large, mais gardait une nappe pleine du
          //     cote du soleil — la ou l'angle rase et ou le lobe large sature
          //     a lui tout seul. Deux octaves, l'une pour la facette, l'autre
          //     pour le grain, et la saturation se produit toujours mais sur
          //     des points, jamais sur une surface.
          //     LE CHAMP MULTIPLIE, IL NE S'AJOUTE PAS, ET C'EST TOUTE LA
          //     DIFFERENCE.
          //
          //     Ecrit « 0,12 + facette », le champ ne descendait jamais sous
          //     0,12 : dans le coin ou le lobe sature — et il sature sur une
          //     grande surface, parce qu'un lobe etroit dans le monde a une
          //     empreinte ECRAN enorme des que l'angle rase — le minimum
          //     valait encore un tiers de blanc, le maximum quatre fois le
          //     blanc, et entre les deux il n'y avait pas de noir. Un chemin de
          //     lumiere n'est pas un degrade de brillance : c'est une alternance
          //     de facettes allumees et de facettes ETEINTES, et sans le zero
          //     il n'y a pas d'alternance.
          //
          //     ET UNE LECON DE BANC, PAYEE TRES CHER SUR CE SHADER-LA.
          //
          //     Le chemin de lumiere se deplace avec le SOLEIL, et le cycle
          //     jour/nuit fait trois minutes. Deux captures prises a deux
          //     minutes d'intervalle ne comparent donc pas deux versions du
          //     code : elles comparent deux heures de la journee. J'ai teste
          //     six hypotheses de cette facon avant de m'en apercevoir, et
          //     aucune des six mesures ne voulait rien dire. Sur ce monde, une
          //     comparaison n'a de sens qu'a heure GELEE.
          float facet = smoothstep(0.40, 0.74, fbm(p * 1.9 + vec2(uTime * 0.30, -uTime * 0.22)));
          float grain = smoothstep(0.36, 0.78, fbm(p * 4.7 - vec2(uTime * 0.21, uTime * 0.33)));
          float sparkle = facet * (0.22 + grain * 1.15);
          float glint = (pow(ndhs, 340.0) * 3.1 + pow(ndhs, 95.0) * 0.24)
                      * sparkle * (1.0 - uRain * 0.72);
          // La paillette prend la couleur du SOLEIL, pas un blanc chaud fixe.
          // C'est elle qui dessine le chemin de lumiere sur l'eau, et un chemin
          // blanc sous un soleil orange est la faute qu'on remarque sans savoir
          // la nommer.
          //     ET LA CONTRIBUTION EST PLAFONNEE. Un pixel a quatre fois le
          //     blanc et un pixel a un et demi rendent le meme blanc a l'ecran
          //     — mais pas le meme bloom : le premier deborde sur trente pixels
          //     alentour, et trente pixels de debordement partout sur un chemin
          //     de lumiere large font une nappe. Le plafond ne change donc rien
          //     a l'image nette et tout a l'image floue.
          c += mix(vec3(1.0, 0.98, 0.90), uDayLight * 1.5, uDayWarm) * min(glint, 1.45);

          // --- Ecume de rive. Elle suit la ligne de flottaison, donc la courbe
          //     de niveau du terrain : c'est gratuit et toujours juste.
          //
          //     LA LARGEUR EST DONNEE EN PROFONDEUR, PAS EN METRES DE PLAGE, et
          //     c'est le piege. Cinquante-cinq centimetres de fond, sur la
          //     greve tres douce d'un atoll, font quarante metres de large :
          //     l'ecume couvrait alors la moitie du lagon d'un aplat blanc que
          //     le bloom achevait de faire deborder sur le sable. Vingt
          //     centimetres donnent une frange, ce qu'une ecume a toujours ete.
          //
          //     Et elle est CRIBLEE. Une bande d'ecume uniforme se lit comme un
          //     ruban peint ; ce qui la rend vivante est qu'elle se retire par
          //     endroits, exactement comme une nappe de retrait sur du sable.
          float foamEdge = 1.0 - smoothstep(0.0, 0.20, vDepth);
          float foamBreak = smoothstep(0.30, 0.72, fbm(vWorld.xz * 0.85 + vec2(uTime * 0.10, 0.0)));
          float foam = foamEdge
                     * (0.55 + 0.45 * sin(vDepth * 26.0 - uTime * 2.4))
                     * (0.45 + 0.55 * foamBreak);
          c = mix(c, foamCol, clamp(foam, 0.0, 1.0) * 0.62);

          // --- L'ECUME DE CRETE. Une vague sans mousse sur le dessus est une
          //     bosse, pas une vague. On la pose la ou la surface est le plus
          //     HAUTE — c'est-a-dire au sommet du train principal — et
          //     seulement au large, ou la houle a de l'amplitude.
          float crest = smoothstep(0.30, 0.85, vCrest);
          c = mix(c, foamCol, crest * smoothstep(0.4, 4.0, vDepth) * 0.34);

          // --- Les nuages assombrissent l'eau comme le reste du paysage.
          float dark = cloudShade(vWorld.xz, uTime);
          c = mix(c, c * 0.58 + uSkyLight * 0.05, dark * 0.8);

          // La lampe du surfeur sur l'eau. Elle y est plus FORTE que sur
          // l'herbe : une surface reflechissante renvoie ce qu'on lui donne, et
          // une lueur qui glisse sur la mer la nuit est l'image que ce jeu
          // cherche depuis le debut.
          c += riderLight(vWorld) * (0.5 + uDayNight * 1.15);

          // Et la surface DIFFUSE : elle se rapproche de sa propre couleur au
          // lieu de rendre le ciel, et le semis de gouttes la blanchit d'un
          // voile mat. Une eau de pluie qui resterait miroir serait la premiere
          // chose qu'on trouverait fausse.
          if (uRain > 0.004) {
            c = mix(c, body, uRain * 0.42);
            // Le crepitement : la surface entiere blanchit sous les impacts.
            c += foamCol * clamp(rainNear, 0.0, 1.0) * 0.095;
          }

          // Opacite : transparente au bord, franche au large. Le haut-fond
          // laisse voir son sable, et c'est la moitie de ce qui fait un lagon.
          float alpha = mix(0.70, 0.97, smoothstep(0.0, 1.3, vDepth));
          gl_FragColor = vec4(c, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(dense), this.mat);
    this.mesh.frustumCulled = false;
    // Apres le sol et les brins, avant les nuages : l'eau doit recouvrir le
    // fond qu'elle cache et se laisser recouvrir par ce qui flotte dessus.
    this.mesh.renderOrder = -860;
  }

  /** @param wake x, z du surfeur et force du sillage — 0 quand il n'est pas dessus. */
  update(camPos: Vector3, origin: Vector3, time: number, wake: Vector3): void {
    const u = this.mat.uniforms;
    u.uCam.value.copy(camPos);
    u.uOrigin.value.copy(origin);
    u.uWake.value.copy(wake);
    u.uTime.value = time;
    this.mesh.position.z = Math.round(origin.z / SNAP) * SNAP;
  }
}

