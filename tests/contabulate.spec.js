// @ts-check
// Shared table behaviour, ported from septuagint-contabulate. Corpus facts live in CFG.
const { test, expect } = require('@playwright/test');

const CFG = {
  title: 'Quran Tabular Explorer',
  books: 114,
  sample: 'الله',
  vocabProbe: 'رحم',
  // The second sura: long enough to exercise paging (40 sections).
  book: { row: 1, prefix: '002.Baqarah.', chapters: 40, lastChapter: '002.Baqarah.§40' },
  firstGenre: { name: 'Meccan', books: 86 },
};

async function waitForDataLoaded(page) {
  await page.waitForFunction(() => window.__contabulateReady === true, { timeout: 15000 });
}

async function search(page, query, { gran = 'play', ngramMode = '1', matchMode = 'exact' } = {}) {
  await page.selectOption('#gran', gran);
  await page.selectOption('#matchMode', matchMode);
  if (matchMode === 'regex') {
    await page.selectOption('#ngramMode', ngramMode);
  }
  await page.fill('#q', query);
  await page.press('#q', 'Enter');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  if (gran === 'line') {
    await expect(page.locator('#results thead')).toContainText('Verse', { timeout: 10000 });
  }
}

test.describe('Page Load', () => {
  test('loads with the instance title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(CFG.title);
  });

  test('shows base stats on first load without commentary columns', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    await expect(page.locator('#segmentsTotalInfo')).toContainText(`(${CFG.books} total rows)`);
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Location'))).toBeTruthy();
    expect(texts.some(t => t.includes('Sura'))).toBeTruthy();
    expect(texts.some(t => t.includes('# words'))).toBeTruthy();
    expect(texts.some(t => t.includes('# verses'))).toBeTruthy();
    expect(texts.some(t => /comment/i.test(t))).toBeFalsy();
    await expect(page.locator('#addColumnsMobile')).toHaveText('+ Metric columns');
    expect(errors).toEqual([]);
  });
});

test.describe('Segments Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
  });

  test('supports exact-term auto ngram detection and removable headers', async ({ page }) => {
    await page.fill('#q', `${CFG.sample} ${CFG.sample}`);
    await page.click('#addColumnBtn');
    await expect(page.locator('#results thead th')).toContainText([`"${CFG.sample} ${CFG.sample}"`]);
    await page.locator('#results thead th button.term-col-remove').click();
    await expect(page.locator('#results thead th')).not.toContainText([`"${CFG.sample} ${CFG.sample}"`]);
  });

  test('+ popover offers metric columns only', async ({ page }) => {
    await page.locator('#results thead th.add-column-th').click();
    const popover = page.locator('.add-column-popover');
    await expect(popover).toBeVisible();
    await expect(popover).not.toContainText('Commentators');
    await popover.locator('.add-column-option', { hasText: 'Lexical Rarity' }).first().click();
    await page.keyboard.press('Escape');
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Lexical Rarity'))).toBeTruthy();
  });

  test('count cells drill down and ancestor cells filter', async ({ page }) => {
    await page.locator('#results tbody tr').nth(CFG.book.row).locator('td[data-key="num_chapters"] button.drill-link').click();
    await expect(page.locator('#gran')).toHaveValue('act');
    await expect(page.locator('#segmentsTotalInfo')).toContainText(`(${CFG.book.chapters} total rows)`);
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText(`starts with ${CFG.book.prefix}`);
    await page.goBack();
    await expect(page.locator('#gran')).toHaveValue('play');
    await page.locator('#results tbody tr').first().locator('td[data-key="genre"] .drill-link').click();
    await expect(page.locator('#segmentsTotalInfo')).toContainText(`(${CFG.firstGenre.books} total rows)`);
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText(`is ${CFG.firstGenre.name}`);
  });

  test('vocabulary granularities put n-grams in the rows', async ({ page }) => {
    await page.selectOption('#gran', 'word');
    await expect(page.locator('#results thead th[data-key="ngram"]')).toHaveCount(1);
    await expect(page.locator('#results thead th[data-key="unusualness"]')).toHaveCount(1);
    await expect(page.locator('#vocabNamesToggle')).toBeHidden();
    await expect(page.locator('#vocabNamesUnavailable')).toBeVisible();
    await expect(page.locator('.ngram-exclude-btn')).toHaveCount(0);
    await page.fill('#q', CFG.vocabProbe);
    await page.locator('#addColumnBtn').click();
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText(`matches ${CFG.vocabProbe}`);
    const words = await page.locator('#results tbody tr td[data-key="ngram"]').allTextContents();
    expect(words.length).toBeGreaterThan(0);
    const probe = new RegExp(CFG.vocabProbe, 'iu');
    expect(words.every(w => probe.test(w))).toBeTruthy();
  });

  test('supports regex mode with explicit ngram selection', async ({ page }) => {
    await search(page, `^${CFG.sample}$`, { gran: 'play', matchMode: 'regex', ngramMode: '1' });
    expect(await page.locator('#results tbody tr').count()).toBeGreaterThan(0);
  });

  test('verse rows render highlights', async ({ page }) => {
    await search(page, CFG.sample, { gran: 'line' });
    await expect(page.locator('#results tbody td .hit').first()).toBeVisible({ timeout: 10000 });
  });

  test('granularity selector uses Verse for verse text rows', async ({ page }) => {
    const options = await page.locator('#gran option').evaluateAll((opts) =>
      opts.map((opt) => ({ value: opt.value, text: (opt.textContent || '').trim() }))
    );
    expect(options.some((opt) => opt.value === 'scene')).toBeFalsy();
    expect(options).toContainEqual({ value: 'line', text: 'Verse' });
  });

  test('maps legacy verse URL granularities to text-backed Verse view', async ({ page }) => {
    for (const legacy of ['line', 'scene']) {
      await page.goto(`/?q=${encodeURIComponent(CFG.sample)}&nm=1&gran=${legacy}&mm=exact&sk=location&sd=asc&cs=1&zr=0&hl=1`);
      await waitForDataLoaded(page);
      await page.waitForSelector('#results tbody tr', { timeout: 10000 });
      await expect(page.locator('#gran')).toHaveValue('line');
      const texts = await page.locator('#results thead th').allTextContents();
      expect(texts.some(t => t.includes('Verse'))).toBeTruthy();
    }
  });
});

test('vocabulary scope survives switching the n-gram size', async ({ page }) => {
  const scope = encodeURIComponent('^' + CFG.book.prefix.replace(/\./g, '\\.'));
  await page.goto(`/?gran=word&s_ft_location=${scope}`);
  await waitForDataLoaded(page);
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  const chip = page.locator('#segmentsActiveFilters .active-filter-chip');
  await expect(chip).toContainText(`starts with ${CFG.book.prefix}`);
  await page.selectOption('#gran', 'bigram');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(chip).toContainText(`starts with ${CFG.book.prefix}`);
  await page.selectOption('#gran', 'trigram');
  await expect(chip).toContainText(`starts with ${CFG.book.prefix}`);
  await page.selectOption('#gran', 'act');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(chip).toContainText(`starts with ${CFG.book.prefix}`);
  await page.selectOption('#gran', 'play');
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
});

test('filter, sort, page, reorder, and full CSV preserve the result', async ({ page }, testInfo) => {
  const fs = require('node:fs');
  const scope = encodeURIComponent('^' + CFG.book.prefix.replace(/\./g, '\\.'));
  await page.goto(`/?gran=act&s_ft_location=${scope}&sk=location&sd=asc`);
  await waitForDataLoaded(page);
  await page.selectOption('#segmentsPageSize', '25');
  await expect(page.locator('#segmentsTotalInfo')).toContainText(`${CFG.book.chapters} total rows`);
  await page.locator('th[data-key="location"]').click();
  await expect(page.locator('#results tbody tr').first()).toContainText(CFG.book.lastChapter);
  await page.click('#segmentsNextPage');
  await expect(page.locator('#results tbody tr')).toHaveCount(Math.min(25, CFG.book.chapters - 25));
  await page.locator('th[data-key="play_title"]').dragTo(page.locator('th[data-key="location"]'));
  await expect(page.locator('#results thead th').first()).toHaveAttribute('data-key', 'play_title');
  await page.locator('#segmentsTab details summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.click('#downloadSegmentsCsv');
  const download = await downloadPromise;
  const destination = testInfo.outputPath('sections.csv');
  await download.saveAs(destination);
  const raw = fs.readFileSync(destination, 'utf8');
  expect(raw.charCodeAt(0)).toBe(0xFEFF); // byte-order mark for spreadsheet programs
  const csv = raw.trim().split('\n');
  expect(csv).toHaveLength(CFG.book.chapters + 1);
  expect(csv[0]).toMatch(/^Sura,Location/);
  expect(csv[1]).toContain(CFG.book.lastChapter);
  await page.reload();
  await waitForDataLoaded(page);
  await expect(page.locator('#results thead th').first()).toHaveAttribute('data-key', 'play_title');
  await expect(page.locator('#segmentsActiveFilters')).toContainText(CFG.book.prefix);
});

test('unsupported names, empty results, invalid regex, and unavailable source recover visibly', async ({ page }) => {
  await page.goto('/?gran=word&xn=1');
  await waitForDataLoaded(page);
  await expect(page.locator('#vocabNamesUnavailable')).toBeVisible();
  await expect(page.locator('#vocabNamesToggle')).toBeHidden();
  await expect(page.locator('.ngram-exclude-btn, .name-dimmed')).toHaveCount(0);
  await page.goto('/?q=zzzznonexistent&gran=line');
  await waitForDataLoaded(page);
  await expect(page.locator('#results tbody')).toContainText(/No /i);
  await expect(page.locator('#loadingIndicator')).toBeHidden();
  await page.goto('/');
  await waitForDataLoaded(page);
  await page.selectOption('#matchMode', 'regex');
  await page.fill('#q', '[');
  await page.click('#addColumnBtn');
  await expect(page.locator('#results tbody')).toContainText('Invalid regex');
  await page.route('**/data/chunks.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.locator('[role="alert"]')).toContainText('Unable to load data');
  await expect(page.locator('#loadingIndicator')).toBeHidden();
});
