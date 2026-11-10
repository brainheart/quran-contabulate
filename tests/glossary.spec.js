// The reading aids for people without Arabic: the English-to-Arabic lookup
// and the gloss, dictionary-form, and root columns of the word views.
const { test, expect } = require('@playwright/test');
const glossary = require('../docs/data/glossary.json');
const tokens = require('../docs/data/tokens.json');

const nfc = text => String(text).normalize('NFC');
const total = word => (tokens[word] || []).reduce((sum, [, n]) => sum + n, 0);
const lemma = arabic => glossary.lemmas.find(e => nfc(e.ar) === nfc(arabic));

async function ready(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('#results tbody tr').first()).toBeVisible();
}

async function hitTotal(page) {
  await page.selectOption('#segmentsPageSize', '250');
  const counts = await page.locator('td[data-key="t0_count"]').allTextContents();
  return counts.map(t => Number(t.replace(/,/g, ''))).reduce((a, b) => a + b, 0);
}

test('an English word finds its Arabic dictionary forms and inserts all their spellings', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await expect(page.locator('#lexicon')).toBeVisible();
  await page.fill('#lexiconInput', 'mercy');
  const first = page.locator('.lexicon-item').first();
  await expect(first.locator('.lexicon-lemma')).toHaveText(lemma('رَحْمَة').ar);
  await expect(first.locator('.lexicon-meaning')).toHaveText('mercy');
  await expect(first.locator('.lexicon-meta')).toContainText('noun · 114× in 17 forms');
  await expect(first.locator('.lexicon-meta')).toContainText('also catches 1 other use of the same spellings');
  await expect(page.locator('.lexicon-item').nth(1).locator('.lexicon-meaning')).toHaveText('to have mercy');

  await first.locator('.lexicon-insert').click();
  await expect(page.locator('#lexiconResults')).toBeHidden();
  await expect(page.locator('#matchMode')).toHaveValue('regex');
  await expect(page.locator('#q')).toBeFocused();
  const pattern = await page.inputValue('#q');
  const matched = Object.keys(tokens).filter(w => new RegExp(pattern, 'u').test(w));
  expect(matched.sort()).toEqual(lemma('رَحْمَة').forms.map(f => f[0]).sort());

  await page.click('#addColumnBtn');
  await expect(page.locator('th[data-key="t0_count"]')).toBeVisible();
  expect(await hitTotal(page)).toBe(matched.reduce((sum, w) => sum + total(w), 0));
  expect(await hitTotal(page)).toBe(115); // 114 of the word, 1 of another written the same
  // The inserted term survives a reload as an ordinary deep link.
  await page.reload();
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('th[data-key="t0_count"]')).toBeVisible();
  expect(await hitTotal(page)).toBe(115);
  expect(errors).toEqual([]);
});

test('a long inserted pattern keeps the header row low until expanded', async ({ page }, testInfo) => {
  const fs = require('node:fs');
  await ready(page);
  const plainHeight = (await page.locator('#results thead tr').boundingBox()).height;
  await page.fill('#lexiconInput', 'say');
  await page.locator('.lexicon-item').first().locator('.lexicon-insert').click();
  const pattern = await page.inputValue('#q');
  expect(pattern.length).toBeGreaterThan(150);
  await page.click('#addColumnBtn');
  const th = page.locator('th[data-key="t0_count"]');
  await expect(th).toBeVisible();
  const label = th.locator('.th-label');
  const toggle = th.locator('.term-col-expand');
  // Cut to one line: the whole pattern is still there, for hover and export.
  await expect(label).toHaveText(`# /${pattern}/`);
  await expect(th).toHaveAttribute('title', new RegExp('^# /\\^'));
  expect((await th.getAttribute('title')).startsWith(`# /${pattern}/`)).toBeTruthy();
  await expect(toggle).toHaveText('more');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const cut = await label.evaluate(el => ({ shown: el.clientWidth, full: el.scrollWidth }));
  expect(cut.full).toBeGreaterThan(cut.shown);
  const collapsed = (await page.locator('#results thead tr').boundingBox()).height;
  expect(collapsed).toBeLessThan(plainHeight + 30);

  // Expanding does not sort or remove the column, and survives a re-render.
  await toggle.click();
  await expect(toggle).toHaveText('less');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(th).toHaveClass(/sorted-desc/);
  expect((await page.locator('#results thead tr').boundingBox()).height).toBeGreaterThan(collapsed + 20);
  await page.locator('th[data-key="location"]').click();
  await expect(page.locator('th[data-key="t0_count"] .term-col-expand')).toHaveText('less');
  await page.locator('th[data-key="t0_count"] .term-col-expand').click();
  await expect(page.locator('th[data-key="t0_count"] .term-col-expand')).toHaveText('more');
  expect((await page.locator('#results thead tr').boundingBox()).height).toBeLessThan(plainHeight + 30);

  // The CSV header carries the whole term, not the shortened one.
  await page.locator('#segmentsTab details summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.click('#downloadSegmentsCsv');
  const destination = testInfo.outputPath('long-term.csv');
  await (await downloadPromise).saveAs(destination);
  expect(fs.readFileSync(destination, 'utf8').split('\n')[0]).toContain(`# /${pattern}/`);

  // Short terms are left alone.
  await ready(page, '/?q=' + encodeURIComponent('الله') + '&gran=play');
  await expect(page.locator('th[data-key="t0_count"] .term-col-expand')).toHaveCount(0);
  await expect(page.locator('th[data-key="t0_count"] .th-label')).not.toHaveClass(/th-label-long/);
});

test('a single written form or a whole root can be inserted instead', async ({ page }) => {
  await ready(page);
  await page.fill('#lexiconInput', 'mercy');
  const first = page.locator('.lexicon-item').first();
  await first.locator('.lexicon-form').first().click();
  await expect(page.locator('#matchMode')).toHaveValue('exact');
  await expect(page.locator('#q')).toHaveValue('رحمة');

  await page.fill('#lexiconInput', 'mercy');
  await page.locator('.lexicon-item').first().locator('.lexicon-root').click();
  await expect(page.locator('#matchMode')).toHaveValue('regex');
  await page.click('#addColumnBtn');
  await expect(page.locator('th[data-key="t0_count"]')).toBeVisible();
  expect(await hitTotal(page)).toBe(339); // every word on the root r-h-m

  // Enter takes the first suggestion.
  await page.fill('#lexiconInput', 'patience');
  await expect(page.locator('.lexicon-item').first().locator('.lexicon-meaning')).toHaveText('patience');
  await page.press('#lexiconInput', 'Enter');
  const pattern = await page.inputValue('#q');
  expect(Object.keys(tokens).filter(w => new RegExp(pattern, 'u').test(w)).sort())
    .toEqual(lemma('صَبْر').forms.map(f => f[0]).sort());
});

test('the lookup also explains an Arabic word, and says so when it finds nothing', async ({ page }) => {
  await ready(page);
  await page.fill('#lexiconInput', 'الرَّحِيمِ');
  await expect(page.locator('.lexicon-item')).toHaveCount(1);
  await expect(page.locator('.lexicon-item .lexicon-lemma')).toHaveText(lemma('رَحِيم').ar);
  await expect(page.locator('.lexicon-item .lexicon-examples')).toContainText('Most Merciful');
  await page.fill('#lexiconInput', 'zzzz');
  await expect(page.locator('#lexiconResults')).toContainText('No Quranic word is glossed with that');
  await page.fill('#lexiconInput', '');
  await expect(page.locator('#lexiconResults')).toBeHidden();
  await page.fill('#lexiconInput', 'light');
  await expect(page.locator('.lexicon-item').first().locator('.lexicon-meaning')).toHaveText('light');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lexiconResults')).toBeHidden();
});

test('every generated pattern matches exactly the written forms of its dictionary form', async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(async () => {
    const [g, tokens] = await Promise.all([fetch('data/glossary.json').then(r => r.json()), fetch('data/tokens.json').then(r => r.json())]);
    const vocabulary = Object.keys(tokens);
    let inexact = 0;
    let longest = 0;
    for (const entry of g.lemmas) {
      const forms = entry.forms.map(f => f[0]);
      const source = window.contabulateGlossary.buildFormsRegex(forms);
      longest = Math.max(longest, source.length);
      const re = new RegExp(source, 'u');
      const hits = vocabulary.filter(w => re.test(w));
      if (hits.length !== forms.length || !forms.every(f => re.test(f))) inexact++;
    }
    return { lemmas: g.lemmas.length, inexact, longest };
  });
  expect(report.lemmas).toBe(4933);
  expect(report.inexact).toBe(0);
  expect(report.longest).toBeLessThan(600);
});

test('word views show an English gloss, dictionary form, and root', async ({ page }) => {
  await ready(page, '/?gran=word');
  const headers = await page.locator('#results thead th').allTextContents();
  for (const label of ['English (word by word)', 'Dictionary form', 'Root']) {
    expect(headers.some(t => t.includes(label))).toBeTruthy();
  }
  const first = page.locator('#results tbody tr').first();
  await expect(first.locator('td[data-key="ngram"]')).toHaveText('من');
  await expect(first.locator('td[data-key="gloss"]')).toHaveText('from; of; any');
  await expect(first.locator('td[data-key="lemma"]')).toHaveAttribute('lang', 'ar');
  const second = page.locator('#results tbody tr').nth(1);
  await expect(second.locator('td[data-key="gloss"]')).toContainText('Allah');
  await expect(second.locator('td[data-key="root"]')).toHaveText('اله');

  // Filtering the Root column gathers every form built on one root.
  await ready(page, '/?gran=word&s_ft_root=' + encodeURIComponent('^رحم$'));
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(47 total rows)');
  // The gloss column is a plain text column: it filters and exports.
  await ready(page, '/?gran=word&s_ft_gloss=' + encodeURIComponent('\\bpatien'));
  const glosses = await page.locator('td[data-key="gloss"]').allTextContents();
  expect(glosses.length).toBeGreaterThan(5);
  expect(glosses.every(t => /patien/i.test(t))).toBeTruthy();

  await ready(page, '/?gran=trigram');
  const trigram = page.locator('#results tbody tr').first();
  await expect(trigram.locator('td[data-key="ngram"]')).toHaveText('يا أيها الذين');
  await expect(trigram.locator('td[data-key="gloss"]')).toHaveText('O · you · those who');
  await expect(page.locator('#results thead th[data-key="lemma"]')).toHaveCount(0);
  await expect(page.locator('#results thead th[data-key="root"]')).toHaveCount(0);
});

test('the explorer works without the glossary file', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/data/glossary.json', route => route.fulfill({ status: 404, body: 'Not found' }));
  await ready(page, '/?gran=word');
  await expect(page.locator('#lexicon')).toBeHidden();
  await expect(page.locator('#results thead th[data-key="gloss"]')).toHaveCount(0);
  await expect(page.locator('#results thead th[data-key="ngram"]')).toHaveCount(1);
  await ready(page, '/?q=' + encodeURIComponent('الله') + '&gran=line');
  await expect(page.locator('#results tbody .hit').first()).toBeVisible();
  await expect(page.locator('td[data-key="gloss"]').first()).not.toBeEmpty(); // Pickthall is separate
  expect(errors).toEqual([]);
});

test('the lookup fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.fill('#lexiconInput', 'mercy');
  await expect(page.locator('.lexicon-item').first()).toBeVisible();
  const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
  const box = await page.locator('#lexiconResults').boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
});
