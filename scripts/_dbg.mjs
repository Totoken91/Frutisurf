import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:600,height:800}});
await p.goto('http://localhost:5173/',{waitUntil:'networkidle'});
await p.waitForTimeout(3500);
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__game;
  const gl = g.engine.renderer.getContext();
  const progs = g.engine.renderer.info.programs ?? [];
  const out = [];
  for (const pr of progs) {
    const shaders = gl.getAttachedShaders(pr.program) ?? [];
    const frag = shaders.map(s => gl.getShaderSource(s) ?? '').find(s => /gl_FragColor/.test(s) && !/gl_Position/.test(s)) ?? '';
    if (/uRimGain/.test(frag)) out.push({ rimInjected: true, snippet: frag.slice(frag.indexOf('uRim * rimF') - 160, frag.indexOf('uRim * rimF') + 60) });
  }
  return { programs: progs.length, rimPrograms: out.length, sample: out[0] ?? null };
}), null, 1));
await b.close();
