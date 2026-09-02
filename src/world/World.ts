import {
  ShaderMaterial,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { col } from '../core/Palette';
import { setTerrain } from './Terrain';
import { WORLD_COLOR_KEYS, WORLDS, worldPalette, type WorldColorKey, type WorldDef } from './Worlds';
import { City } from './City';
import { Town } from './Town';
import { Boosters } from './Boosters';
import { Rings } from './Rings';
import { Clouds } from './Clouds';
import { Ground } from './Ground';
import { GrassBlades } from './GrassBlades';
import { Motes } from './Motes';
import { Leaves } from './Leaves';
import { Rain } from './Rain';
import { setWind } from './Weather';
import { Water } from './Water';
import { Palms } from './Palms';
import { Turbines } from './Turbines';
import { Daylight, pushDay } from './Daylight';
import { pushTerrain } from './Terrain';
import { createEnvironment } from './Environment';
import { createSky, SUN_DIR } from './Sky';
import type { Quality } from '../core/Engine';

/**
 * Assemblage du decor. Tout est ancre sur `origin` (la position du surfeur) :
 * le joueur ne s'eloigne jamais de l'origine, c'est le monde qui recule.
 */
export class World {
  readonly ground: Ground;
  readonly blades: GrassBlades | null;
  readonly motes: Motes;
  readonly leaves: Leaves;
  readonly rain: Rain;
  readonly water: Water;
  readonly palms: Palms;
  readonly turbines: Turbines;
  /** L'heure. Source unique, relue par tous les materiaux ci-dessous. */
  readonly day: Daylight;
  /** Tout ce qui doit recevoir l'heure. Une liste, pour n'en oublier aucun. */
  private lit: Array<{ uniforms: Record<string, { value: unknown } | undefined> }> = [];
  private key!: DirectionalLight;
  private hemi!: HemisphereLight;
  readonly clouds: Clouds;
  readonly city = new City();
  readonly town = new Town();
  readonly boosters: Boosters;
  readonly rings: Rings;
  readonly lights = new Group();
  private sky: Mesh;

  // --- LE MONDE COURANT, ET LE FONDU.
  //
  // On ne charge pas un monde, on FOND vers lui. `from` est celui qu'on
  // quitte, `to` celui qu'on rejoint, `mix` va de 0 a 1 en un peu plus d'une
  // seconde. Tout ce qui definit un monde — relief, eau, greve, vingt et une
  // couleurs, quatre densites de decor, la matiere du sol et les quatre
  // palettes de ciel — passe par ce meme fondu, sans exception.
  //
  // C'est ce qui permet a l'ecran de selection de laisser le monde VIVANT
  // derriere lui : le joueur touche OKINAWA, et la plaine s'inonde sous ses
  // yeux pendant qu'il lit la carte suivante. Un monde detruit puis reconstruit
  // n'aurait jamais pu faire ca, et aurait coute un a-coup a chaque essai.
  private from: WorldDef = WORLDS[0];
  private to: WorldDef = WORLDS[0];
  private mix = 1;
  /** Couleurs melangees de l'image courante. Reecrites, jamais recreees. */
  private tint = new Map<WorldColorKey, Color>();
  private amp: number[] = [0, 0, 0, 0, 0];
  private swell: number[] = [0, 60, 1];

  constructor(scene: Scene, renderer: WebGLRenderer, quality: Quality, start: WorldDef = WORLDS[0]) {
    this.from = start;
    this.to = start;
    this.day = new Daylight(start.sky, start.dayStart);
    for (const k of WORLD_COLOR_KEYS) this.tint.set(k, new Color());
    const dense = quality !== 'low';
    this.ground = new Ground(dense, quality === 'low' ? 384 : 512);
    // Le champ de touffes existe MEME en qualite basse, avec un rayon reduit.
    // Il avait d'abord ete coupe la par prudence, mais c'est une erreur de
    // diagnostic : le poste couteux sur telephone etait la transmission du
    // verre (un rendu de scene complet par image), pas la geometrie. Vingt-cinq
    // mille triangles a shader trivial ne coutent rien, et sans eux le premier
    // plan redevient l'aplat vert que le jeu vient justement de quitter.
    this.blades = new GrassBlades(quality === 'high' ? 64 : quality === 'medium' ? 46 : 40, 0.38);
    // L'atlas est genere au boot pixel par pixel : sa resolution est le seul
    // poste de chargement du jeu. 768 sur machine confortable, 512 sinon.
    // Effectifs revus a la baisse : a 72 nuages le ciel etait sature et le
    // banc d'horizon masquait completement la ville.
    this.clouds = new Clouds(
      quality === 'high' ? 44 : quality === 'medium' ? 34 : 24,
      quality === 'low' ? 512 : 768,
    );
    this.boosters = new Boosters(dense ? 6 : 5);
    this.rings = new Rings(dense ? 8 : 6);
    this.water = new Water(dense);
    this.palms = new Palms();
    this.turbines = new Turbines(dense ? 14 : 9);
    this.motes = new Motes(quality === 'high' ? 420 : quality === 'medium' ? 280 : 170);
    // Feuilles et pluie existent dans TOUS les mondes, a densite nulle hors
    // d'octobre : c'est un quad par instance rejete des le sommet, soit rien.
    // Les creer a la demande aurait coute une compilation de shader au moment
    // precis ou l'on veut un fondu sans a-coup — exactement ce que toute
    // l'architecture des mondes existe pour eviter.
    this.leaves = new Leaves(quality === 'high' ? 1900 : quality === 'medium' ? 1200 : 700);
    this.rain = new Rain(quality === 'high' ? 3000 : quality === 'medium' ? 1900 : 1000);

    scene.environment = createEnvironment(renderer);
    this.sky = createSky();
    scene.add(this.sky);
    scene.add(this.ground.mesh);
    if (this.blades) scene.add(this.blades.mesh);
    scene.add(this.water.mesh);
    scene.add(this.palms.mesh, this.turbines.mesh);
    scene.add(this.city.group);
    scene.add(this.town.buildings, this.town.halos);
    scene.add(this.clouds.mesh);
    scene.add(this.boosters.mesh);
    scene.add(this.rings.veil, this.rings.group);
    scene.add(this.motes.mesh);
    scene.add(this.leaves.mesh, this.rain.mesh);

    // Key : les highlights speculaires du verre.
    const key = new DirectionalLight(0xffffff, 2.6);
    this.key = key;
    key.position.copy(SUN_DIR).multiplyScalar(100);

    // Hemisphere : le rebond VERT du sol dans le buddy. Indispensable.
    const hemi = new HemisphereLight(col('skyMid').getHex(), col('grassMid').getHex(), 1.5);
    this.hemi = hemi;

    // Fill : debouche le contre-jour sans tuer le rim.
    const fill = new DirectionalLight(col('buddyHot').getHex(), 0.6);
    fill.position.set(-40, 18, -60);

    this.lights.add(key, hemi, fill);

    // --- Le registre des materiaux eclaires. Une LISTE, tenue a la main : un
    //     balayage automatique de la scene attraperait aussi les materiaux qui
    //     n'ont pas d'heure (le HUD n'en a pas, les anneaux non plus), et
    //     surtout il attraperait silencieusement les futurs. Ici, ajouter un
    //     decor sans l'inscrire se voit tout de suite : il reste en plein midi.
    this.lit = [
      (this.sky.material as ShaderMaterial),
      this.ground.mat,
      this.water.mat,
      this.palms.mat,
      this.turbines.mat,
      this.clouds.mat,
      this.motes.mat,
      this.leaves.mat,
      this.rain.mat,
      ...this.town.mats,
    ].filter(Boolean) as typeof this.lit;
    if (this.blades) this.lit.push(this.blades.mat);
    this.blendWorld(1);
    this.applyDay();
    scene.add(this.lights);
  }

  /** Le monde vers lequel on va. C'est lui que l'ecran de selection annonce. */
  get world(): WorldDef {
    return this.to;
  }

  /**
   * Intensite d'averse COURANTE, fondu compris. Lue par l'audio.
   *
   * Pas `this.to.rain` : pendant la seconde de transition vers Octobre, la
   * pluie serait deja a plein volume alors que le ciel n'a pas fini de se
   * couvrir. Ce qu'on entend doit etre ce qu'on voit.
   */
  get rainAmount(): number {
    return this.rainMix;
  }

  private rainMix = 0;

  /**
   * Demande un monde. Le fondu part de l'etat COURANT et non du monde
   * precedent : changer d'avis au milieu d'une transition enchaine proprement
   * au lieu de sauter en arriere.
   */
  setWorld(next: WorldDef, instant = false): void {
    if (next === this.to && !instant) return;
    // On fige l'etat courant comme point de depart. Le seul moyen honnete de
    // le faire sans inventer un troisieme monde intermediaire est de repartir
    // du monde de depart quand on est deja arrive, et de laisser le fondu en
    // cours se terminer sinon — d'ou le `mix` conserve.
    this.from = this.mix >= 1 ? this.to : this.from;
    this.to = next;
    this.mix = instant ? 1 : Math.min(this.mix, 0.0);
    this.day.from = this.from.sky;
    this.day.to = next.sky;
    if (instant) {
      this.from = next;
      this.day.from = next.sky;
      this.day.phase = next.dayStart;
    }
    this.blendWorld(instant ? 1 : this.mix);
  }

  /**
   * Applique l'etat melange. `t` = 0 -> `from`, 1 -> `to`.
   *
   * Le relief passe par `setTerrain`, qui ecrit dans les tableaux PARTAGES avec
   * les shaders : une seule ecriture met a jour la physique et les six
   * materiaux qui deplacent des sommets, sans qu'aucun n'ait a etre prevenu.
   */
  private blendWorld(t: number): void {
    const a = this.from;
    const b = this.to;
    const L = (x: number, y: number): number => x + (y - x) * t;

    for (let i = 0; i < 5; i++) this.amp[i] = L(a.amp[i], b.amp[i]);
    for (let i = 0; i < 3; i++) this.swell[i] = L(a.swell[i], b.swell[i]);
    setTerrain(this.amp, L(a.water, b.water), L(a.shore[0], b.shore[0]), L(a.shore[1], b.shore[1]), this.swell);

    const pa = worldPalette(a);
    const pb = worldPalette(b);
    for (const k of WORLD_COLOR_KEYS) {
      this.tint.get(k)!.copy(pa.get(k)!).lerp(pb.get(k)!, t);
    }
    this.day.mix = t;

    // Le VENT passe par le meme tableau partage que le relief : une seule
    // ecriture sert la physique du Controller et les trois couches qui le
    // montrent. Il se fond comme le reste — la bourrasque monte pendant que la
    // plaine se couvre, elle n'apparait pas d'un coup.
    setWind(L(a.wind, b.wind));

    this.paint({
      city: L(a.city, b.city),
      turbines: L(a.turbines, b.turbines),
      palms: L(a.palms, b.palms),
      blades: L(a.blades, b.blades),
      leaves: L(a.leaves, b.leaves),
      trees: L(a.trees, b.trees),
      town: L(a.town, b.town),
      rain: L(a.rain, b.rain),
      wind: L(a.wind, b.wind),
      tech: L(a.tech, b.tech),
      overcast: L(a.overcast, b.overcast),
    });
  }

  /**
   * Pousse les couleurs et les densites du monde dans les materiaux.
   *
   * La liste est ECRITE A LA MAIN, comme le registre `lit` : un balayage
   * automatique attraperait des uniformes de meme nom qui n'ont rien a voir
   * (`uNear` existe ailleurs), et surtout il rendrait invisible l'oubli d'un
   * decor ajoute plus tard. Ici, un decor qu'on n'inscrit pas reste bloque sur
   * les couleurs de la plaine, et ca se voit du premier coup d'oeil.
   */
  private paint(d: {
    city: number;
    turbines: number;
    palms: number;
    blades: number;
    leaves: number;
    trees: number;
    town: number;
    rain: number;
    wind: number;
    tech: number;
    overcast: number;
  }): void {
    const c = (k: WorldColorKey): Color => this.tint.get(k)!;
    // Un uniforme absent est ignore quand on l'a DIT — les tours et la ligne
    // d'arbres ne partagent pas les memes noms — et signale sinon. Sans ce
    // partage explicite, une faute de frappe laisserait un decor bloque sur la
    // palette de la plaine sans un mot, et c'est exactement le genre de panne
    // qui survit des mois.
    //
    // Un premier jet comptait simplement les manques et attendait « quatre » :
    // il y en avait trois, et l'alerte n'a rien signale d'autre que ma propre
    // erreur de comptage. Un nombre magique ne dit pas QUOI manque ; un drapeau
    // par appel, si. `check:shaders` echoue sur toute erreur de console, donc
    // le filet est deja tendu.
    const missing: string[] = [];
    const rgb = (u: { value: unknown } | undefined, k: WorldColorKey, optional = false): void => {
      if (!u) {
        if (!optional) missing.push(k);
        return;
      }
      const col3 = c(k);
      const v = u.value as number[];
      v[0] = col3.r;
      v[1] = col3.g;
      v[2] = col3.b;
    };

    const g = this.ground.mat.uniforms;
    rgb(g.uNear, 'grassNear');
    rgb(g.uMid, 'grassMid');
    rgb(g.uFar, 'grassFar');
    rgb(g.uHorizon, 'grassHorizon');
    rgb(g.uShadow, 'grassShadow');
    rgb(g.uStreak, 'grassStreak');
    rgb(g.uSandDry, 'sandDry');
    rgb(g.uSandPale, 'sandPale');
    rgb(g.uSandWet, 'sandWet');
    rgb(g.uSandShell, 'sandShell');
    g.uTech.value = d.tech;
    g.uWet.value = d.rain;
    // Le tapis suit la densite des feuilles en vol : les deux decrivent la
    // meme saison, il serait absurde qu'un monde ait l'une sans l'autre.
    g.uLitter.value = d.leaves;
    rgb(g.uLeafA, 'leafRust');
    rgb(g.uLeafB, 'leafBlood');

    const w = this.water.mat.uniforms;
    rgb(w.uShallow, 'waterShallow');
    rgb(w.uDeep, 'waterDeep');
    rgb(w.uFoam, 'waterFoam');
    w.uRain.value = d.rain;

    const lv = this.leaves.mat.uniforms;
    rgb(lv.uLeafA, 'leafRust');
    rgb(lv.uLeafB, 'leafBlood');
    rgb(lv.uLeafC, 'leafAmber');
    lv.uDensity.value = d.leaves;
    lv.uWind.value = d.wind;

    const rn = this.rain.mat.uniforms;
    rn.uAmount.value = d.rain;
    this.rainMix = d.rain;
    rn.uWind.value = d.wind;

    if (this.blades) {
      const b = this.blades.mat.uniforms;
      rgb(b.uBase, 'grassNear');
      rgb(b.uTip, 'grassHorizon');
      rgb(b.uGlow, 'grassStreak');
      b.uDensity.value = d.blades;
      b.uWind.value = d.wind;
      b.uTown.value = d.town;
    }

    const p = this.palms.mat.uniforms;
    rgb(p.uTrunk, 'warmAccent');
    rgb(p.uFrond, 'grassNear');
    rgb(p.uFrondTip, 'grassFar');
    p.uDensity.value = d.palms;

    this.turbines.mat.uniforms.uDensity.value = d.turbines;

    // --- LE QUARTIER. Deux materiaux : les batiments et les halos.
    const t0 = this.town.mats[0].uniforms;
    rgb(t0.uWall, 'townWall');
    rgb(t0.uTree, 'treeLine');
    rgb(t0.uRoof, 'townRoof');
    rgb(t0.uWindow, 'townWindow');
    t0.uDensity.value = d.town;
    t0.uWet.value = d.rain;
    t0.uOvercast.value = d.overcast;
    const t1 = this.town.mats[1].uniforms;
    rgb(t1.uWindow, 'townWindow');
    t1.uDensity.value = d.town;
    t1.uWet.value = d.rain;

    // Le sol porte la route et les flaques de lampadaire : elles ne peuvent
    // pas vivre dans le decor, qui ne connait pas le pixel de sol qu'il
    // eclaire (cf. Town.TOWN_GLSL, relu par Ground).
    g.uTown.value = d.town;
    g.uOvercast.value = d.overcast;
    rgb(g.uLamp, 'townWindow');

    // Deux materiaux aux jeux d'uniformes DIFFERENTS : les tours ont uFace,
    // uLit et uDeep ; la ligne d'arbres a uDark et uLit. D'ou les manques
    // declares optionnels de part et d'autre.
    for (const m of this.city.mats) {
      const tree = !!m.uniforms.uDark;
      const u = m.uniforms;
      rgb(u.uFace, 'cityFace', tree);
      rgb(u.uDeep, 'cityDeep', tree);
      rgb(u.uDark, 'treeLine', !tree);
      // La ligne d'arbres emprunte son `uLit` a l'HERBE et non a la ville :
      // c'est de la vegetation, elle doit suivre le vert du monde.
      rgb(u.uLit, tree ? 'grassNear' : 'cityLit');
      // La ligne d'arbres a sa PROPRE densite depuis qu'un monde a voulu la
      // foret sans les tours.
      u.uDensity.value = tree ? d.trees : d.city;
    }

    // Le plafond ne concerne QUE le dome : c'est lui qui porte le soleil.
    (this.sky.material as ShaderMaterial).uniforms.uOvercast.value = d.overcast;

    const cl = this.clouds.mat.uniforms;
    rgb(cl.uCore, 'cloudCore');
    rgb(cl.uShadow, 'cloudShadow');
    rgb(cl.uRim, 'cloudRim');

    if (!this.painted) {
      this.painted = true;
      if (missing.length) {
        console.error(`World.paint : uniforme(s) introuvable(s) — ${missing.join(', ')}`);
      }
    }
  }

  private painted = false;

  /** Pousse l'heure courante dans chaque materiau et dans les deux lampes. */
  private applyDay(): void {
    const d = this.day;
    for (const m of this.lit) {
      pushDay(m.uniforms, d);
      pushTerrain(m.uniforms);
    }

    // Le dome de ciel a ses propres couleurs, qui SONT l'heure.
    const sky = (this.sky.material as ShaderMaterial).uniforms;
    (sky.uZenith.value as Color).copy(d.zenith);
    (sky.uHigh.value as Color).copy(d.high);
    (sky.uMid.value as Color).copy(d.mid);
    (sky.uHorizon.value as Color).copy(d.horizon);
    sky.uNight.value = d.night;

    // L'eau reflechit le ciel : ses deux couleurs de reflet viennent donc du
    // cycle et non de la palette. Sans ca, un lac garde un reflet de midi sous
    // un ciel de crepuscule, et c'est la premiere chose que l'oeil remarque.
    const w = this.water.mat.uniforms;
    (w.uSkyLow.value as Color).copy(d.horizon);
    (w.uSkyHigh.value as Color).copy(d.mid);

    // La BRUME de la ville et de la ligne d'arbres est le ciel a l'horizon, pas
    // une couleur de palette. Fixee au cyan canonique, elle rendait la foret de
    // CHROME turquoise sous un ciel magenta — une bande d'un autre monde posee
    // au milieu de celui-ci. C'est le meme principe que le reflet de l'eau :
    // tout ce qui se dissout dans l'horizon doit relire l'horizon.
    for (const m of this.city.mats) {
      const h = m.uniforms.uHaze;
      if (!h) continue;
      const v = h.value as number[];
      v[0] = d.horizon.r;
      v[1] = d.horizon.g;
      v[2] = d.horizon.b;
    }

    this.key.color.copy(d.light);
    this.key.intensity = 2.6 * d.power;
    this.hemi.color.copy(d.mid);
    this.hemi.intensity = 1.5 * (0.45 + d.power * 0.55);
  }

  /** Nouvelle partie : le parcours entier est reseme devant le joueur. */
  reset(originZ: number): void {
    this.boosters.reseedAll(originZ);
    this.rings.reseedAll(originZ);
  }

  update(
    origin: Vector3,
    camPos: Vector3,
    time: number,
    speedN: number,
    dt: number,
    cast: Vector3,
    wake: Vector3,
  ): void {
    // Le dome de ciel SUIT la camera. Fixe a l'origine, son bord finissait par
    // traverser la camera (le ciel scintillait), puis on en sortait et tout
    // passait au noir — apres environ 70 s de jeu a vitesse de croisiere.
    // L'heure AVANT tout le reste : chaque couche doit lire la meme.
    // Le fondu de monde AVANT l'heure : le ciel du jour courant depend du
    // melange des deux mondes, donc `mix` doit etre a jour quand Daylight
    // echantillonne.
    if (this.mix < 1) {
      // 1,15 s, et une courbe en S. Un fondu lineaire sur un relief qui monte
      // et descend se lit comme un ascenseur ; la courbe donne un depart et une
      // arrivee doux, ce qui est la seule chose qui empeche le mal de mer.
      this.mix = Math.min(1, this.mix + dt / 1.15);
      const t = this.mix * this.mix * (3 - 2 * this.mix);
      this.blendWorld(t);
      if (this.mix >= 1) this.from = this.to;
    }
    this.day.step(dt);
    this.applyDay();
    this.sky.position.copy(camPos);
    this.ground.update(camPos, origin, time, speedN, cast);
    this.blades?.update(origin, time, speedN);
    this.water.update(camPos, origin, time, wake);
    this.palms.update(origin, time);
    this.turbines.update(origin, time);
    this.clouds.update(origin, time);
    this.city.update(origin);
    this.town.update(origin, camPos);
    this.boosters.update(origin, time);
    this.rings.update(origin, time, dt);
    this.motes.update(origin, time);
    this.leaves.update(origin, time);
    // La pluie se replie autour de la CAMERA et non du joueur : c'est elle qui
    // definit ce qu'on voit, et un champ centre sur le disque laisserait un
    // trou juste devant l'objectif quand la camera recule dans un virage.
    this.rain.update(camPos, time);
  }
}
