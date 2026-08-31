import { chromium, devices } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
let bad = 0;
for (const [name, opts] of [['bureau', { viewport: { width: 420, height: 740 } }],
                            ['telephone', { ...devices['iPhone 13'], hasTouch: true, isMobile: true, viewport: { width: 380, height: 680 } }]]) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const glsl = errs.filter((e) => /ERROR: \d+:\d+|shader/i.test(e));
  console.log(`${glsl.length ? 'ECHEC' : 'OK  '}  ${name.padEnd(10)} ${glsl.length} erreur(s) de shader`);
  glsl.slice(0, 3).forEach((e) => e.split('\n').slice(0, 3).forEach((l) => console.log('    ', l)));
  bad += glsl.length;
  await ctx.close();
}
await b.close();
process.exitCode = bad ? 1 : 0;
