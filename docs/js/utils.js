// Utility functions — pure helpers with no state dependencies
// Extracted from index.html

(function () {
  'use strict';

// Arabic search form, mirrored by normalize() in build.py: vowel marks,
// recitation signs, and tatweel are dropped and alef wasla is written as
// plain alef. Letters (hamza forms, alef maksura, ta marbuta) stay as written.
const WORD_RE = /\p{L}+/gu;
const MARK_RE = /[\p{M}\u0640]/gu;
const MARK_CLASS = '[\\p{M}\\u0640]';
const ALEF_WASLA_RE = /\u0671/g;

function stripArabicMarks(text) {
  return String(text || '').normalize('NFC').replace(MARK_RE, '').replace(ALEF_WASLA_RE, '\u0627');
}

function normalizeTerm(term) {
  return stripArabicMarks(term).toLowerCase().replace(/\s+/g, ' ').trim();
}

// A regex is matched against the search form, so marks typed or pasted into
// the pattern are dropped the same way.
function normalizeRegexSource(text) {
  return stripArabicMarks(text);
}

function parseNumeric(text) {
  if (text == null) return NaN;
  const raw = String(text).trim();
  if (!raw) return NaN;
  const s = raw.replace(/,/g, '');
  // Strict numeric: optional sign, digits with optional decimal OR leading decimal, optional trailing %.
  // Entire cell must match; avoids treating values like "3H6" as numeric.
  const re = /^-?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
  if (!re.test(s)) return NaN;
  const num = parseFloat(s.replace('%',''));
  return Number.isFinite(num) ? num : NaN;
}

function pickTextColorForBg(rgbStr) {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(rgbStr);
  if (!m) return '#1a1a1a';
  const r = parseInt(m[1],10), g = parseInt(m[2],10), b = parseInt(m[3],10);
  const brightness = (r*299 + g*587 + b*114) / 1000; // YIQ
  return brightness < 170 ? '#ffffff' : '#1a1a1a';
}

function quantiles(arr, qs) {
  if (!arr.length) return qs.map(() => NaN);
  const a = [...arr].sort((x,y)=>x-y);
  const n = a.length;
  return qs.map(q => {
    if (n === 1) return a[0];
    const pos = (n - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return a[base] + (a[Math.min(base+1, n-1)] - a[base]) * rest;
  });
}

function normName(s){ return String(s||'').toUpperCase().replace(/\s+/g,' ').trim(); }

function formatCellNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value == null ? '' : String(value);
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fmtPct(num) { return (num*100).toFixed(3) + '%'; }

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function highlightHTML(text, re) {
  if (!re) return escapeHTML(text);
  let out = '';
  let last = 0;
  const s = String(text);
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index;
    const end = start + (m[0]?.length || 0);
    out += escapeHTML(s.slice(last, start));
    out += '<span class="hit">' + escapeHTML(m[0]) + '</span>';
    last = end;
    if (!re.global) break;
    if (end === start) re.lastIndex++; // avoid zero-width infinite loop
  }
  out += escapeHTML(s.slice(last));
  return out;
}

function toCsvValue(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, rows) {
  // The byte-order mark lets spreadsheet programs read the Arabic as UTF-8.
  const csv = '\uFEFF' + rows.map(r => r.map(toCsvValue).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stripTags(text) {
  return String(text || '').replace(/<[^>]*>/g, '').trim();
}

function countRegexMatches(text, re) {
  if (!re) return 0;
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  let count = 0;
  let m;
  while ((m = r.exec(text))) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    count++;
  }
  return count;
}

function tokenizeLineText(text) {
  const m = stripArabicMarks(text).toLowerCase().match(WORD_RE);
  return m ? m : [];
}

function getLineTokens(line) {
  if (!line) return [];
  if (!line._tokensCache) {
    line._tokensCache = tokenizeLineText(line.text);
  }
  return line._tokensCache;
}

function getLineNgrams(line, n) {
  if (!line) return [];
  if (!line._ngramsCache) line._ngramsCache = {};
  if (!line._ngramsCache[n]) {
    const toks = getLineTokens(line);
    const out = [];
    for (let i = 0; i <= toks.length - n; i++) {
      out.push(toks.slice(i, i + n).join(' '));
    }
    line._ngramsCache[n] = out;
  }
  return line._ngramsCache[n];
}

function escapeRegexText(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHighlightRegexFromNgrams(ngrams) {
  if (!Array.isArray(ngrams) || ngrams.length === 0) return null;
  const parts = [];
  for (const ng of ngrams) {
    // The displayed verse is fully vocalized: let marks follow every letter
    // and let a plain alef also find alef wasla.
    const tokens = ng.split(' ').filter(Boolean).map(token => Array.from(token)
      .map(ch => (ch === '\u0627' ? '[\u0627\u0671]' : escapeRegexText(ch)) + MARK_CLASS + '*').join(''));
    if (tokens.length === 0) continue;
    // Words are separated by at least one character that is neither a letter
    // nor a mark; free-standing pause signs may sit in the gap.
    parts.push("(?<![\\p{L}\\p{M}])" + tokens.join("[^\\p{L}\\p{M}][^\\p{L}]*") + "(?![\\p{L}\\p{M}])");
  }
  if (parts.length === 0) return null;
  return new RegExp(parts.join('|'), 'giu');
}

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function paginateArray(arr, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return arr.slice(start, end);
}

function getTotalPages(totalRows, pageSize) {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function setElementHidden(el, hidden) {
  if (!el || !el.classList) return;
  el.classList.toggle('is-hidden', !!hidden);
}

function showElement(el) {
  setElementHidden(el, false);
}

function hideElement(el) {
  setElementHidden(el, true);
}

  // Expose on window
  window.normalizeTerm = normalizeTerm;
  window.normalizeRegexSource = normalizeRegexSource;
  window.stripArabicMarks = stripArabicMarks;
  window.parseNumeric = parseNumeric;
  window.pickTextColorForBg = pickTextColorForBg;
  window.quantiles = quantiles;
  window.normName = normName;
  window.fmtPct = fmtPct;
  window.formatCellNumber = formatCellNumber;
  window.escapeHTML = escapeHTML;
  window.highlightHTML = highlightHTML;
  window.toCsvValue = toCsvValue;
  window.downloadCsv = downloadCsv;
  window.stripTags = stripTags;
  window.countRegexMatches = countRegexMatches;
  window.tokenizeLineText = tokenizeLineText;
  window.getLineTokens = getLineTokens;
  window.getLineNgrams = getLineNgrams;
  window.escapeRegexText = escapeRegexText;
  window.buildHighlightRegexFromNgrams = buildHighlightRegexFromNgrams;
  window.debounce = debounce;
  window.paginateArray = paginateArray;
  window.getTotalPages = getTotalPages;
  window.setElementHidden = setElementHidden;
  window.showElement = showElement;
  window.hideElement = hideElement;
})();
