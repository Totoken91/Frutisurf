import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:600,height:900}});
await p.goto('http://localhost:5173/',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
await p.keyboard.down('ArrowRight');
await p.waitForTimeout(2200);
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__game;
  const t = g.trail;
  const pos = t.mesh.geometry.getAttribute('position');
  const ages = t.mesh.geometry.getAttribute('aAge');
  const c = g.controller;
  const cam = g.engine.camera;
  const first = [pos.getX(0), pos.getY(0), pos.getZ(0)];
  const tenth = [pos.getX(20), pos.getY(20), pos.getZ(20)];
  // Combien de particules de spray sont vivantes ?
  const birth = g.spray.mesh.geometry.getAttribute('iBirth');
  let alive = 0;
  for (let i = 0; i < birth.count; i++) {
    const age = g.__time ?? 0;
    if (birth.getX(i) > -900) alive++;
  }
  return {
    surfer: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
    camera: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)],
    speed: +c.speed.toFixed(1), steer: +c.steer.value.toFixed(2), charge: +c.carveCharge.toFixed(2),
    trailVisible: t.mesh.visible,
    trailVert0: first.map(v => +v.toFixed(2)),
    trailVert20: tenth.map(v => +v.toFixed(2)),
    trailAge0: +ages.getX(0).toFixed(2), trailAge20: +ages.getX(20).toFixed(2),
    trailIndexCount: t.mesh.geometry.index.count,
    sprayEverSpawned: alive,
  };
}), null, 1));
await b.close();
