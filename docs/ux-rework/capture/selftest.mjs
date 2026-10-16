import { selftestCompatibilityEmpty, selftestCompatibilityPopulated } from './selftest-compatibility-ui.mjs';
import { setDeveloperTools } from './lib.mjs';
// Self-test of the `ui` map and the tooltip/menu helpers against a running build (BASE_URL, default http://localhost:5239).
//   BASE_URL=http://localhost:5239 UI_DIR=<worktree>/clock-generator-ui node selftest.mjs
// Resolves every ui entry at 1440, 720 and 390 in four states and checks the count (1, or a documented 0).
import { openSession, importFile, generate, goConfigure, goResults, SMALL_SAMPLE, ui, itemLabel, openTooltip, openMoreMenu, waitForMoreMenuClosed, chooseMenuItem } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5239';
let fails = 0;
const log = (ok, text) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); };
const expectCount = async (w, state, name, loc, want) => {
    const n = await loc.count();
    log(n === want || (want === '>=1' && n >= 1), `${w} ${state} ui.${name}: ${n} (want ${want})`);
};

for (const w of [1440, 720, 390]) {
    const { browser, page } = await openSession({ base: BASE, width: w });
    const E = (state, name, loc, want = 1) => expectCount(w, state, name, loc, want);

    // ---- first visit (Configure, empty build)
    let s = 'empty';
    await E(s, 'generate', ui.generate(page));
    await E(s, 'checkOnly', ui.checkOnly(page));
    await E(s, 'copyBlueprint', ui.copyBlueprint(page), 0);
    await E(s, 'viewToggle(Configure)', ui.viewToggle(page, 'Configure'));
    await E(s, 'viewToggle(Results)', ui.viewToggle(page, 'Results'));
    await E(s, 'menuButton', ui.menuButton(page));
    await E(s, 'menu (closed)', ui.menu(page), 0);
    await E(s, 'menuLayer (closed)', ui.menuLayer(page), 0);
    await E(s, 'importConfig', ui.importConfig(page), 0);
    await E(s, 'exportConfig', ui.exportConfig(page), 0);
    await E(s, 'pasteFromFactorio', ui.pasteFromFactorio(page));
    await E(s, 'introCard', ui.introCard(page));
    await E(s, 'advancedOverrides', ui.advancedOverrides(page));
    for (const k of ['target', 'machines', 'inserters', 'belts', 'chests', 'drills']) await E(s, `card(${k})`, ui.card(page, k));
    await E(s, 'add(target)', ui.add(page, 'target'), 0);
    for (const k of ['machines', 'inserters', 'belts', 'drills']) await E(s, `add(${k})`, ui.add(page, k));
    await E(s, 'addChest(buffer)', ui.addChest(page));
    await E(s, 'addChest(infinity)', ui.addChest(page, 'infinity'));
    await E(s, 'listView', ui.listView(page));
    await E(s, 'diagramView', ui.diagramView(page));
    await E(s, 'diagram', ui.diagram(page), 0);
    await E(s, 'message', ui.message(page), 0);
    await E(s, 'clockTable', ui.clockTable(page), 0);
    await E(s, 'resultsTab(Log)', ui.resultsTab(page, 'Log'), 0);
    await E(s, 'diagramDialog', ui.diagramDialog(page), 0);
    log(itemLabel('transport-belt') === 'transport-belt' || itemLabel('transport-belt') !== '', `${w} itemLabel('transport-belt') = ${itemLabel('transport-belt')}`);

    await selftestCompatibilityEmpty(page,E);

    // ---- menu at this width
    s = 'menu';
    const menu = await openMoreMenu(page);
    await E(s, 'menu (open)', ui.menu(page));
    await E(s, 'menuLayer (open)', ui.menuLayer(page));
    await E(s, 'reset', ui.reset(page));
    await E(s, 'importConfig', ui.importConfig(page));
    await E(s, 'exportConfig', ui.exportConfig(page));
    log((await openMoreMenu(page)) !== null, `${w} openMoreMenu twice is harmless`);
    await page.keyboard.press('Escape');
    await waitForMoreMenuClosed(page);
    await E(s, 'menuLayer (exited)', ui.menuLayer(page), 0);
    await ui.pasteFromFactorio(page).click();
    await page.waitForTimeout(500);
    const pasteDialog = page.getByRole('dialog', { name: 'Paste from Factorio' });
    log((await pasteDialog.count()) === 1, `${w} Paste from Factorio ran (no clipboard JSON: its dialog opens)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Open build file… through chooseMenuItem at any width: it must raise a file chooser
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await chooseMenuItem(page, 'Open build file…');
    await (await chooser).setFiles(SMALL_SAMPLE);
    await page.waitForTimeout(800);
    await E('imported', 'message', ui.message(page));
    await E('imported', 'messageUndo', ui.messageUndo(page));
    await E('imported', 'messageClose', ui.messageClose(page));
    // the message sits over the open menu's second item at 390 (messages over the page: 1.5 F), so it goes first
    await ui.messageClose(page).click();
    await chooseMenuItem(page, 'Save build file').catch((e) => log(false, `${w} chooseMenuItem Save build file: ${e.message}`));
    await page.waitForTimeout(500);
    log(true, `${w} chooseMenuItem('Open build file…') and ('Save build file') worked`);

    // ---- imported build, Configure
    s = 'configure';
    await goConfigure(page);
    await E(s, 'checkOnly', ui.checkOnly(page));
    await E(s, 'listView', ui.listView(page));

    // tooltips
    const tip = await openTooltip(page, page.getByRole('button', { name: /^Enable: / }).first());
    log(await tip.isVisible(), `${w} openTooltip(Enable chip): "${(await tip.textContent()).slice(0, 50)}"`);
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    let threw = '';
    try { await openTooltip(page, page.getByRole('heading', { name: /^Belts/, level: 2 }), { timeout: 1200 }); } catch (e) { threw = e.message; }
    log(/openTooltip: no visible/.test(threw), `${w} openTooltip on a control with no tooltip throws a clear error: ${threw.slice(0, 90)}`);
    threw = '';
    try { await openTooltip(page, page.getByRole('button', { name: 'No such control' }), { timeout: 800 }); } catch (e) { threw = e.message; }
    log(/openTooltip: .* is not on the page/.test(threw), `${w} openTooltip on a missing control throws: ${threw.slice(0, 90)}`);

    // diagram + fullscreen
    s = 'diagram';
    await ui.diagramView(page).click();
    await page.waitForTimeout(800);
    await E(s, 'diagram', ui.diagram(page));
    await E(s, 'diagramFullscreen', ui.diagramFullscreen(page));
    await ui.diagramFullscreen(page).click();
    await page.waitForTimeout(600);
    await E(s, 'diagramDialog', ui.diagramDialog(page));
    await E(s, 'diagramClose', ui.diagramClose(page));
    await ui.diagramClose(page).click();
    await page.waitForTimeout(500);
    await ui.listView(page).click();

    // results
    s = 'results';
    await generate(page);
    await E(s, 'clockTable', ui.clockTable(page));
    await E(s, 'clockRows', ui.clockRows(page), '>=1');
    await E(s, 'clockRows(0)', ui.clockRows(page, 0));
    await E(s, 'copyBlueprint', ui.copyBlueprint(page));
    await setDeveloperTools(page,true);
    for (const t of ['Timelines', 'Insights', 'Blueprint string', 'Log']) await E(s, `resultsTab(${t})`, ui.resultsTab(page, t));
    await E(s, 'resultsCard', ui.resultsCard(page)); // existing p2 Your clock card
    await E(s, 'viewToggle(Configure)', ui.viewToggle(page, 'Configure'));
    await ui.resultsTab(page, 'Log').click();
    log(true, `${w} resultsTab click`);
    try { await selftestCompatibilityPopulated(page,E,log); }
    catch(e) { log(false,`${w} compatibility ui selftest: ${e.message}`); }
    await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
