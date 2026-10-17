'use strict';
// Temporary diagnostic: the packaged app's picker on macOS, then Reset permission.
const { _electron: electron } = require('playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await electron.launch({ executablePath: '/Applications/STC Recorder.app/Contents/MacOS/STC Recorder' });
  app.on('window', (page) => page.on('pageerror', (e) => console.log('DIAG pageerror', e.message)));
  const main = await app.firstWindow();
  await main.waitForLoadState('domcontentloaded');
  await wait(2000);
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await main.evaluate(() => document.getElementById('src').click());
  const picker = await opened;
  await wait(6000);
  console.log('DIAG picker', JSON.stringify(await picker.evaluate(() => ({
    hint: !document.getElementById('screenHint').hidden,
    screens: document.querySelectorAll('#screens .card').length,
    detail: document.getElementById('screenDetail').textContent,
  }))));
  const closed = new Promise((r) => app.process().on('exit', (code) => r(`app exited ${code}`)));
  await picker.evaluate(() => document.getElementById('resetScreen').click()).catch(() => {});
  const res = await Promise.race([closed, wait(10000).then(() => 'app still running')]);
  console.log('DIAG after reset:', res);
  if (res === 'app still running') {
    console.log('DIAG reset error:', await picker.evaluate(() => document.getElementById('resetError').textContent));
    await app.close();
  }
})().catch((e) => { console.log('DIAG fatal', e && e.stack); process.exit(1); });
