const { test, expect } = require('@playwright/test');
const instance = require('../docs/instance.json');
const tokens = require('../docs/data/tokens.json');

async function ready(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('#results tbody tr').first()).toBeVisible();
}

function localPath(sampleUrl) {
  const url = new URL(sampleUrl);
  return url.pathname + url.search;
}

// Literals typed here may order stacked vowel marks differently from the
// source text; compare in canonical order.
const nfc = text => String(text).normalize('NFC');
const total = word => (tokens[word] || []).reduce((sum, [, n]) => sum + n, 0);
const DIVINE_NAME = /^([وفأ]*[بت]?ا?|آ)لله$/;

test('sample queries load, answer their question, and survive a copied link', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  expect(instance.sample_queries).toHaveLength(4);
  const [without, densest, moses, refrain] = instance.sample_queries;

  // Suras that never use the divine name sort first, with zero hits.
  await ready(page, localPath(without.url));
  await expect(page.locator('#gran')).toHaveValue('play');
  await expect(page.locator('#matchMode')).toHaveValue('regex');
  await expect(page.locator('#showZeroRows')).toBeChecked();
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(114 total rows)');
  await page.selectOption('#segmentsPageSize', '250');
  const counts = (await page.locator('td[data-key="t0_count"]').allTextContents()).map(t => Number(t.replace(/,/g, '')));
  expect(counts.filter(n => n === 0)).toHaveLength(29);
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  const expected = Object.keys(tokens).filter(w => DIVINE_NAME.test(w)).reduce((sum, w) => sum + total(w), 0);
  expect(expected).toBe(2699);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(expected);

  await ready(page, localPath(densest.url));
  await expect(page.locator('th[data-key="t0_pct"]')).toHaveClass(/sorted-desc/);
  await expect(page.locator('#results tbody tr').first()).toContainText('Al-Ikhlas');
  await expect(page.locator('#results tbody tr').first().locator('td[data-key="t0_pct"]')).toHaveText('13.333%');
  const copied = await context.newPage();
  await ready(copied, page.url());
  await expect(copied.locator('#results tbody tr').first()).toContainText('Al-Ikhlas');
  await copied.close();

  await ready(page, localPath(moses.url));
  await expect(page.locator('#results tbody tr').first()).toContainText("Al-A'raf");
  const mosesCounts = (await page.locator('td[data-key="t0_count"]').allTextContents()).map(Number);
  expect(mosesCounts.reduce((a, b) => a + b, 0)).toBe(136);

  await ready(page, localPath(refrain.url));
  await expect(page.locator('#gran')).toHaveValue('line');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(31 total rows)');
  await expect(page.locator('#results tbody tr').first()).toContainText('055.Rahman.§01.013');
  await expect(page.locator('#results tbody .hit')).toHaveCount(31);
  expect(errors).toEqual([]);
});

test('search ignores vowel marks, recitation signs, alef wasla, and Unicode form', async ({ page }) => {
  const expected = (tokens['الله'] || []).length;
  expect(expected).toBeGreaterThan(1500);
  for (const typed of ['الله', 'اللَّهُ', 'ٱللَّهِ', 'اللَّهُ'.normalize('NFD'), 'اللـــه']) {
    await ready(page, '/?q=' + encodeURIComponent(typed) + '&gran=line');
    await expect(page.locator('#segmentsTotalInfo')).toContainText(`(${expected} total rows)`);
  }
  // Letters are matched as written: the hamza forms stay distinct.
  expect(total('أن')).not.toBe(total('إن'));
  await ready(page, '/?q=' + encodeURIComponent('إن') + '&gran=play');
  const counts = (await page.locator('td[data-key="t0_count"]').allTextContents()).map(Number);
  await page.selectOption('#segmentsPageSize', '250');
  const all = (await page.locator('td[data-key="t0_count"]').allTextContents()).map(Number);
  expect(counts.length).toBeGreaterThan(0);
  expect(all.reduce((a, b) => a + b, 0)).toBe(total('إن'));
  // A vocalized regex is matched in its search form too.
  await ready(page, '/');
  await page.selectOption('#gran', 'word');
  await page.selectOption('#matchMode', 'regex');
  await page.fill('#q', '^[وفبل]*مُوسَىٰ$');
  await page.click('#addColumnBtn');
  const words = await page.locator('td[data-key="ngram"]').allTextContents();
  expect(words.sort()).toEqual(['بموسى', 'لموسى', 'موسى', 'وموسى'].sort());
});

test('highlighting covers vocalized words and respects word boundaries', async ({ page }) => {
  await ready(page, '/');
  const helper = await page.evaluate(() => ({
    tokens: tokenizeLineText('ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ ۩'),
    word: highlightHTML('وَاللَّهُ غَفُورٌ ۚ اللَّهُ لَا إِلَٰهَ', buildHighlightRegexFromNgrams(['الله'])),
    phrase: highlightHTML('لَا رَيْبَ ۛ فِيهِ ۛ هُدًى', buildHighlightRegexFromNgrams(['ريب فيه'])),
    wasla: highlightHTML('بِسْمِ ٱللَّهِ', buildHighlightRegexFromNgrams(['الله'])),
    prefix: highlightHTML('اللَّهُمَّ', buildHighlightRegexFromNgrams(['الله'])),
  }));
  expect(helper.tokens).toEqual(['ذلك', 'الكتاب', 'لا', 'ريب', 'فيه', 'هدى', 'للمتقين']);
  // The attached-particle form is a different word and is left alone.
  expect(helper.word).toBe('وَاللَّهُ غَفُورٌ ۚ <span class="hit">اللَّهُ</span> لَا إِلَٰهَ');
  expect(helper.phrase).toBe('لَا <span class="hit">رَيْبَ ۛ فِيهِ</span> ۛ هُدًى');
  expect(helper.wasla).toBe('بِسْمِ <span class="hit">ٱللَّهِ</span>');
  expect(helper.prefix).not.toContain('class="hit"');

  await ready(page, '/?q=' + encodeURIComponent('رب العالمين') + '&gran=line&sk=location&sd=asc');
  const first = page.locator('#results tbody tr').first();
  await expect(first).toContainText('001.Fatihah.§01.002');
  expect(nfc(await first.locator('.hit').textContent())).toBe(nfc('رَبِّ الْعَالَمِينَ'));
});

test('verse rows show right-to-left Arabic with the English gloss beside it', async ({ page }) => {
  await ready(page, '/?gran=line&sk=location&sd=asc&s_ft_location=' + encodeURIComponent('^002\\.Baqarah\\.§34\\.'));
  const row = page.locator('#results tbody tr', { hasText: '002.Baqarah.§34.255' });
  const verse = row.locator('td[data-key="line"]');
  await expect(verse).toHaveAttribute('lang', 'ar');
  await expect(verse).toHaveAttribute('dir', 'rtl');
  expect(nfc(await verse.textContent())).toContain(nfc('الْحَيُّ الْقَيُّومُ'));
  await expect(row.locator('td[data-key="gloss"]')).toContainText('Allah! There is no deity save Him, the Alive, the Eternal.');
  await expect(row.locator('td[data-key="act"]')).toHaveText('34');
  await expect(row.locator('td[data-key="scene"]')).toHaveText('255');
  const headers = await page.locator('#results thead th').allTextContents();
  expect(headers.some(t => t.includes('English (Pickthall)'))).toBeTruthy();
  expect(headers.some(t => t.includes('Section'))).toBeTruthy();
});

test('the English and Arabic text columns can be filtered', async ({ page }) => {
  // English: a plain regex over the gloss.
  await ready(page, '/?gran=line&sk=location&sd=asc&s_ft_gloss=' + encodeURIComponent('Lord of the Worlds'));
  await expect(page.locator('#results tbody tr').first()).toContainText('001.Fatihah.§01.002');
  const english = await page.locator('td[data-key="gloss"]').allTextContents();
  expect(english.length).toBeGreaterThan(10);
  expect(english.every(t => /Lord of the Worlds/i.test(t))).toBeTruthy();
  // Arabic: an unvocalized filter finds the vocalized verse text.
  await ready(page, '/?gran=line&sk=location&sd=asc&s_ft_line=' + encodeURIComponent('رب العالمين'));
  await expect(page.locator('#results tbody tr').first()).toContainText('001.Fatihah.§01.002');
});

test('suras carry their Arabic name, meaning, period, and order of revelation', async ({ page }) => {
  await ready(page, '/?gran=play&sk=revelation_order&sd=asc');
  const first = page.locator('#results tbody tr').first();
  await expect(first.locator('td[data-key="title"]')).toHaveText("Al-'Alaq");
  await expect(first.locator('td[data-key="name_ar"]')).toHaveText('العلق');
  await expect(first.locator('td[data-key="name_ar"]')).toHaveAttribute('dir', 'rtl');
  await expect(first.locator('td[data-key="meaning"]')).toHaveText('The Clinging Clot');
  await expect(first.locator('td[data-key="genre"]')).toHaveText('Meccan');
  await ready(page, '/?gran=genre');
  await expect(page.locator('#results tbody tr')).toHaveCount(2);
  await expect(page.locator('#results tbody')).toContainText('Medinan');
  await ready(page, '/?gran=act&sk=location&sd=asc&s_ft_location=' + encodeURIComponent('^002\\.Baqarah\\.'));
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(40 total rows)');
  await expect(page.locator('#results tbody tr').first()).toContainText('002.Baqarah.§01');
  // A section's verse count opens exactly that section's verses.
  await page.locator('#results tbody tr').first().locator('td[data-key="verse_count"] .drill-link').click();
  await expect(page.locator('#gran')).toHaveValue('line');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(7 total rows)');
  await page.goBack();
  await expect(page.locator('#gran')).toHaveValue('act');
});

test('metric columns describe pauses, not sentences', async ({ page }) => {
  await ready(page, '/?gran=play&mc=wps,hapax&sk=location&sd=asc');
  const header = page.locator('th[data-key="words_per_sentence"]');
  await expect(header).toContainText('Words/Pause');
  await expect(header).toHaveAttribute('title', /recitation pauses/);
  await expect(page.locator('th[data-key="hapax_share"]')).toHaveAttribute('title', /nowhere else in the Quran/);
  // Al-Fatihah: 29 words in 7 verses with no internal pause signs.
  await expect(page.locator('#results tbody tr').first().locator('td[data-key="words_per_sentence"]')).toHaveText('4.1');
});

test('desktop and mobile layouts keep the table usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await expect(page.locator('h1')).toContainText('☪️ Quran Tabular Explorer');
  await expect(page.locator('#gran option[value="genre"]')).toHaveText('Period');
  await expect(page.locator('#gran option[value="play"]')).toHaveText('Sura');
  await expect(page.locator('#gran option[value="act"]')).toHaveText('Section');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#addColumnsMobile')).toBeVisible();
  const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth,
    table: document.querySelector('#results').scrollWidth, tableWidth: document.querySelector('#results').clientWidth }));
  expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.table).toBeGreaterThan(bounds.tableWidth);
  const mobileButton = await page.locator('#addColumnsMobile').boundingBox();
  const input = await page.locator('#q').boundingBox();
  expect(mobileButton.y).toBeGreaterThan(input.y + input.height);
  expect(mobileButton.height).toBeLessThan(75);
  await page.goto('/sources.html');
  await expect(page.locator('h1')).toHaveText('Edition and sources');
  await expect(page.locator('main')).toContainText('Tanzil Project');
  await expect(page.locator('main a[href="https://tanzil.net/"]')).toHaveCount(1);
});
