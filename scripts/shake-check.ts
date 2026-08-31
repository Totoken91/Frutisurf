/**
 * Verification de la SECOUSSE de camera.
 *
 * Un « ça clignote » et un « la caméra saute quand on clique » peuvent etre le
 * meme defaut : une camera qui se deplace d'une quantite visible A CHAQUE
 * IMAGE. Personne ne le voit sur une capture, et le banc d'essai navigateur ne
 * le voit pas non plus — sous rendu logiciel il tourne a deux images par
 * seconde, et diviser par un `dt` de 500 ms ecrase precisement le saut d'une
 * image qu'on cherche.
 *
 * On pilote donc le rig directement, a 60 Hz exacts, sans rendu. Deux
 * grandeurs, et la seconde est celle qui compte :
 *
 *  - le DEPLACEMENT du point de vue. Il deplace la parallaxe : tout le premier
 *    plan balaie l'ecran. C'est lui qui fait « la camera est arrachee ».
 *  - la ROTATION. Elle dereglé la visee sans toucher a la parallaxe : c'est
 *    ainsi que le cinema secoue une camera, et l'oeil la lit comme un impact.
 *
 * Le contrat : une secousse doit se voir (sinon elle ne sert a rien) mais
 * rester CONTINUE — pas de bond d'une image a l'autre qui lise comme une
 * teleportation ou un grelottement.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../src/fx/CameraRig';
import type { Controller } from '../src/player/Controller';

const STEP = 1 / 60;

/** Surfeur immobile : on ne mesure QUE ce que la secousse ajoute. */
function stubController(): Controller {
  return {
    x: 0, y: 0, z: 0,
    groundY: 0,
    speedNorm: 0.5,
    airborne: false,
    gliding: false,
    steer: { value: 0 },
    lean: { value: 0 },
  } as unknown as Controller;
}

interface Result {
  /** Deplacement du point de vue, metres, pire ecart entre deux images. */
  maxPos: number;
  meanPos: number;
  /** Ecart de visee entre deux images consecutives, degres. */
  maxStep: number;
  meanStep: number;
  /** Ecart de visee par rapport a la meme scene SANS secousse. L'AMPLEUR. */
  peak: number;
  /**
   * Proportion d'images ou le mouvement CHANGE DE SENS. C'est le critere qui
   * separe une oscillation d'un bruit blanc, et il ne depend pas de la
   * frequence : une sinusoide echantillonnee dix fois par cycle s'inverse une
   * image sur cinq, un bruit blanc une image sur deux.
   */
  reversals: number;
  /** Temps, en secondes apres le dernier coup, pour retomber sous 10 % du pic. */
  settle: number;
}

/**
 * @param punches secousses a injecter, sous la forme [instant, force, fov].
 *
 * Deux rigs tournent en parallele sur la MEME base de temps : l'un recoit les
 * secousses, l'autre non. Comparer les deux isole exactement ce que la secousse
 * ajoute, sans avoir a modeliser ce que la camera aurait fait sans elle.
 */
function run(punches: Array<[number, number, number]>, seconds = 4): Result {
  const cam = new PerspectiveCamera(62, 0.6, 0.1, 2600);
  const rig = new CameraRig(cam);
  const refCam = new PerspectiveCamera(62, 0.6, 0.1, 2600);
  const refRig = new CameraRig(refCam);
  const c = stubController();
  rig.snap(c);
  refRig.snap(c);

  // Chauffe : `snap()` pose la camera a sa position de depart, pas a son
  // regime permanent, et le ressort met une demi-seconde a rejoindre l'un
  // depuis l'autre. Mesurer pendant ce transitoire reviendrait a accuser la
  // secousse du deplacement d'installation.
  let t = 0;
  for (; t < 1; t += STEP) {
    rig.update(STEP, c, t);
    refRig.update(STEP, c, t);
  }

  let prevPos: Vector3 | null = null;
  let prevDir: Vector3 | null = null;
  let maxPos = 0, sumPos = 0, maxStep = 0, sumStep = 0, peak = 0, n = 0;
  let flips = 0;
  let prevSigned = 0;
  let lastPunchT = 0;
  let settle = 0;
  const trace: Array<[number, number]> = [];
  let next = 0;
  for (const p of punches) p[0] += 1; // les instants sont donnes apres la chauffe

  const fwd = new Vector3();
  const refFwd = new Vector3();
  while (t < seconds + 1) {
    while (next < punches.length && punches[next][0] <= t) {
      rig.punch(punches[next][1], punches[next][2]);
      lastPunchT = t;
      next++;
    }
    rig.update(STEP, c, t);
    refRig.update(STEP, c, t);

    const pos = cam.position.clone();
    const dir = fwd.set(0, 0, -1).applyQuaternion(cam.quaternion).clone();
    const refDir = refFwd.set(0, 0, -1).applyQuaternion(refCam.quaternion);
    const deg = (a: Vector3, b: Vector3): number =>
      (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;

    const dev = deg(dir, refDir);
    peak = Math.max(peak, dev);
    trace.push([t, dev]);
    if (prevPos && prevDir) {
      const dp = pos.distanceTo(prevPos);
      const da = deg(dir, prevDir);
      maxPos = Math.max(maxPos, dp);
      maxStep = Math.max(maxStep, da);
      sumPos += dp;
      sumStep += da;
      n++;
      // Sens du mouvement vertical de la visee : son signe suffit a compter
      // les inversions, et c'est l'axe le plus rapide des trois.
      const signed = dir.y - prevDir.y;
      if (prevSigned !== 0 && Math.sign(signed) !== Math.sign(prevSigned) && signed !== 0) flips++;
      if (signed !== 0) prevSigned = signed;
    }
    prevPos = pos;
    prevDir = dir;
    t += STEP;
  }
  // Temps de retour au calme : derniere image ou la deviation depasse encore
  // 10 % du pic, comptee depuis le dernier coup.
  // Sans secousse il n'y a rien a faire retomber : le seuil relatif n'a alors
  // aucun sens et marquerait chaque image.
  if (peak > 0.01) {
    for (const [tt, dev] of trace) if (dev > peak * 0.1 && tt >= lastPunchT) settle = tt - lastPunchT;
  }

  return {
    maxPos, meanPos: sumPos / n,
    maxStep, meanStep: sumStep / n,
    peak, reversals: flips / n, settle,
  };
}

function line(name: string, r: Result): void {
  console.log(
    `${name.padEnd(30)} ampleur ${r.peak.toFixed(2).padStart(5)} deg   ` +
      `inversions ${(r.reversals * 100).toFixed(0).padStart(3)} %   ` +
      `retour au calme ${r.settle.toFixed(2)} s   ` +
      `point de vue ${(r.maxPos * 100).toFixed(2).padStart(5)} cm/image`,
  );
}

// Au repos : seul le bruit de tenue en main joue.
const repos = run([]);
// Un pop de carve a pleine charge, l'evenement le plus violent du jeu.
const pop = run([[0.5, 0.35, 14]]);
// L'enchainement qui faisait tout partir : anneau haut + plot + pop + figure
// dans la meme seconde. C'est un bon enchainement, pas un cas pathologique.
const combo = run([
  [0.5, 0.24, 13],
  [0.7, 0.20, 11],
  [0.9, 0.35, 14],
  [1.1, 0.22, 11],
]);

line('repos', repos);
line('pop charge', pop);
line('enchainement anneau+plot+pop', combo);

const fails: string[] = [];

// 1. Le point de vue ne doit quasiment pas bouger : c'est lui qui casse la
//    parallaxe. Seul le bruit de tenue en main a le droit d'y toucher.
if (combo.maxPos > 0.02) {
  fails.push(
    `le point de vue bouge de ${(combo.maxPos * 100).toFixed(1)} cm en une image : ` +
      `la parallaxe se reorganise, ca lit comme une teleportation`,
  );
}

// 2. AMPLEUR : la secousse doit se voir. A 62 degres de champ sur 860 pixels,
//    un degre vaut environ 14 pixels — en dessous d'un demi-degre, un pop
//    charge ne se distingue plus du bruit de tenue en main.
if (pop.peak < 0.5) {
  fails.push(`un pop charge ne devie la visee que de ${pop.peak.toFixed(2)} deg : la secousse ne se voit plus`);
}

// 3. CONTINUITE, le critere central. Une secousse d'impact DOIT bouger vite —
//    la brider reviendrait a la supprimer. Ce qui la distingue d'un
//    grelottement n'est donc pas sa vitesse mais sa COHERENCE : une oscillation
//    garde son sens plusieurs images d'affilee, un bruit blanc en change une
//    image sur deux. Au-dela de 35 %, ce n'est plus un mouvement, c'est du
//    grain — et une image entiere qui grene, l'oeil l'appelle « ca clignote ».
if (combo.reversals > 0.35) {
  fails.push(
    `la visee change de sens ${(combo.reversals * 100).toFixed(0)} % des images : ` +
      `c'est du bruit blanc, pas une secousse`,
  );
}

// 3 bis. Et elle doit RETOMBER. Une secousse qui s'eternise cesse d'etre lue
//        comme un impact et devient une camera instable.
if (combo.settle > 0.7) {
  fails.push(`la secousse met ${combo.settle.toFixed(2)} s a retomber : ce n'est plus un impact`);
}

// 4. Le cumul doit etre plafonne : quatre evenements coup sur coup ne doivent
//    pas secouer beaucoup plus fort qu'un seul, sinon c'est precisement quand
//    le joueur reussit que la camera devient illisible.
if (combo.peak > pop.peak * 1.8) {
  fails.push(
    `l'enchainement devie ${(combo.peak / pop.peak).toFixed(1)}x plus qu'un pop seul : ` +
      `le cumul n'est pas plafonne`,
  );
}

// 5. Au repos, la camera ne doit rien faire de perceptible.
if (repos.peak > 0.05) {
  fails.push(`la camera bouge de ${repos.peak.toFixed(2)} deg au repos, sans aucun evenement`);
}

if (fails.length) {
  console.error('\nECHEC :');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK : la secousse se voit, reste continue, et ne deplace pas le point de vue.');
