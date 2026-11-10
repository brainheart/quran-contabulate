// English reading aids, shared by the non-English Contabulate instances: a
// gloss and dictionary form (and, where the language has them, a root) for
// every word form, and an English lookup that inserts search terms. Nothing
// here is searched or counted; it only helps a reader who has little or none
// of the corpus language find and recognize words.
//
// Data contract (data/glossary.json, written by the instance's build):
//   meta:   { lang, dir }               language tag and direction of the corpus
//   forms:  { form: [count, [glosses], [lemma indexes]] }
//   lemmas: [{ lemma, pos, root?, n, def?, en: [example glosses],
//              w: [[english word, weight]], forms: [[form, count]] }]
// The file must be identical in every instance: fix it once and copy it.

(function () {
  'use strict';

  let data = null;
  let rootIndex = null;
  let meta = { lang: '', dir: 'ltr' };

  function init(glossary) {
    if (!glossary || !glossary.forms || !Array.isArray(glossary.lemmas)) return false;
    data = glossary;
    meta = Object.assign({ lang: '', dir: 'ltr' }, glossary.meta || {});
    rootIndex = new Map();
    data.lemmas.forEach((entry, i) => {
      if (!entry.root) return;
      if (!rootIndex.has(entry.root)) rootIndex.set(entry.root, []);
      rootIndex.get(entry.root).push(i);
    });
    return true;
  }

  function available() { return !!data; }
  function hasRoots() { return !!(rootIndex && rootIndex.size); }

  function formEntry(form) {
    return (data && Object.prototype.hasOwnProperty.call(data.forms, form)) ? data.forms[form] : null;
  }

  // Up to three glosses for a single word; the most frequent gloss of each
  // word for a phrase.
  function ngramGloss(ngram) {
    if (!data) return '';
    const words = String(ngram || '').split(' ').filter(Boolean);
    if (words.length === 1) {
      const entry = formEntry(words[0]);
      // Glosses that are themselves lists are set apart more firmly.
      return entry ? entry[1].join(entry[1].some(g => g.includes(';')) ? ' | ' : '; ') : '';
    }
    return words.map(w => { const e = formEntry(w); return e && e[1].length ? e[1][0] : '…'; }).join(' · ');
  }

  function listSeparator() { return /^ar\b/.test(meta.lang) ? '، ' : ', '; }

  function formLemmas(form) {
    const entry = formEntry(form);
    return entry ? entry[2].map(i => data.lemmas[i]).filter(Boolean) : [];
  }

  function ngramLemma(ngram) {
    const words = String(ngram || '').split(' ').filter(Boolean);
    if (words.length !== 1) return '';
    return Array.from(new Set(formLemmas(words[0]).map(e => e.lemma))).join(listSeparator());
  }

  function ngramRoot(ngram) {
    const words = String(ngram || '').split(' ').filter(Boolean);
    if (words.length !== 1) return '';
    return Array.from(new Set(formLemmas(words[0]).map(e => e.root).filter(Boolean))).join(listSeparator());
  }

  // --- A compact regex that matches exactly a set of word forms -------------
  function trieOf(forms, reversed) {
    const trie = new Map();
    for (const form of forms) {
      let node = trie;
      const chars = Array.from(form);
      if (reversed) chars.reverse();
      for (const ch of chars) {
        if (!node.has(ch)) node.set(ch, new Map());
        node = node.get(ch);
      }
      node.set('', true);
    }
    return trie;
  }
  function emit(node, reversed) {
    const end = node.has('');
    const alternatives = [];
    for (const [ch, child] of node) {
      if (ch === '') continue;
      const rest = emit(child, reversed);
      alternatives.push(reversed ? rest + escapeRegexText(ch) : escapeRegexText(ch) + rest);
    }
    if (!alternatives.length) return '';
    const single = alternatives.every(a => Array.from(a).length === 1);
    let body;
    if (alternatives.length === 1) {
      body = (end && !single) ? `(?:${alternatives[0]})` : alternatives[0];
    } else {
      body = single ? `[${alternatives.join('')}]` : `(?:${alternatives.join('|')})`;
    }
    return end ? body + '?' : body;
  }
  function buildFormsRegex(forms) {
    const unique = Array.from(new Set(forms.filter(Boolean)));
    if (!unique.length) return '';
    if (unique.length === 1) return `^${escapeRegexText(unique[0])}$`;
    // Arabic words share stems more than beginnings: try both directions.
    const forward = emit(trieOf(unique, false), false);
    const backward = emit(trieOf(unique, true), true);
    return `^${backward.length < forward.length ? backward : forward}$`;
  }

  // --- English lookup (a word of the corpus language is explained instead) ------
  function englishWords(text) {
    return String(text || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  }
  function wordScore(entry, word) {
    let exact = 0;
    let partial = 0;
    for (const [w, count] of entry.w) {
      if (w === word) exact += count;
      // Short queries match whole words only: "sea" should not find "seated".
      else if (word.length >= 4 && w.startsWith(word)) partial += count;
    }
    if (!exact && !partial && entry.def) {
      const inDefinition = englishWords(entry.def);
      if (inDefinition.includes(word)) exact = Math.max(1, Math.round(entry.n / 2));
      else if (word.length >= 4 && inDefinition.some(w => w.startsWith(word))) partial = Math.max(1, Math.round(entry.n / 2));
    }
    return exact + partial / 2;
  }
  function search(query, limit = 12) {
    if (!data) return [];
    const text = String(query || '').trim();
    if (!text) return [];
    // A word of the corpus itself: show what it is, before any English match.
    const seen = new Set();
    const out = [];
    for (const word of tokenizeLineText(text)) {
      for (const entry of formLemmas(word)) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        out.push({ entry, score: Infinity });
      }
    }
    const words = englishWords(text);
    if (!words.length) return out.slice(0, limit);
    for (const entry of data.lemmas) {
      if (seen.has(entry)) continue;
      let score = Infinity;
      for (const word of words) {
        const s = wordScore(entry, word);
        if (!s) { score = 0; break; }
        score = Math.min(score, s);
      }
      if (score > 0 && score !== Infinity) out.push({ entry, score });
    }
    out.sort((a, b) => (b.score === a.score ? 0 : b.score > a.score ? 1 : -1) || (b.entry.n - a.entry.n));
    return out.slice(0, limit);
  }

  function formsOf(entry) { return entry.forms.map(f => f[0]); }
  function rootEntries(root) {
    return (rootIndex && rootIndex.get(root) || []).map(i => data.lemmas[i]);
  }
  // How many occurrences a set of spellings catches, and how many of those
  // belong to other words written the same way.
  function coverage(entries) {
    const forms = new Set();
    let own = 0;
    for (const entry of entries) {
      for (const [form, count] of entry.forms) { forms.add(form); own += count; }
    }
    let total = 0;
    for (const form of forms) total += (formEntry(form) || [0])[0];
    return { forms: Array.from(forms), total, other: Math.max(0, total - own) };
  }
  function summary(entry) {
    if (entry.def) return entry.def;
    const top = entry.w.length ? entry.w[0][1] : 0;
    const words = entry.w.filter(([, c]) => c >= top * 0.25).slice(0, 3).map(([w]) => w);
    return words.join(', ') || (entry.en || [])[0] || '';
  }

  // --- The lookup box -----------------------------------------------------------
  function wireLookup({ input, results, insert }) {
    if (!input || !results) return;
    function close() { results.classList.add('is-hidden'); results.innerHTML = ''; }
    function button(className, label, title, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = className;
      b.title = title;
      b.append(...[].concat(label));
      b.addEventListener('click', onClick);
      return b;
    }
    function foreign(text, className) {
      const span = document.createElement('span');
      if (meta.lang) span.lang = meta.lang;
      span.dir = meta.dir;
      span.className = className || 'lexicon-foreign';
      span.textContent = text;
      return span;
    }
    function render() {
      const found = search(input.value);
      results.innerHTML = '';
      if (!input.value.trim()) { close(); return; }
      results.classList.remove('is-hidden');
      if (!found.length) {
        const empty = document.createElement('p');
        empty.className = 'muted lexicon-empty';
        empty.textContent = 'No word in this text is glossed with that. Try another English word.';
        results.appendChild(empty);
        return;
      }
      for (const { entry } of found) {
        const item = document.createElement('div');
        item.className = 'lexicon-item';
        const cover = coverage([entry]);
        const head = document.createElement('div');
        head.className = 'lexicon-head';
        const allTitle = `Insert a pattern matching all ${cover.forms.length} written forms of this word`;
        head.appendChild(button('lexicon-insert', [foreign(entry.lemma, 'lexicon-foreign lexicon-lemma')], allTitle, () => {
          insert(buildFormsRegex(cover.forms), 'regex');
          close();
        }));
        const meaning = document.createElement('span');
        meaning.className = 'lexicon-meaning';
        meaning.textContent = summary(entry);
        head.appendChild(meaning);
        const meta = document.createElement('span');
        meta.className = 'muted lexicon-meta';
        const caught = cover.other
          ? `; the pattern also catches ${formatCellNumber(cover.other)} other use${cover.other === 1 ? '' : 's'} of the same spellings` : '';
        meta.textContent = `${entry.pos} · ${formatCellNumber(entry.n)}× in ${cover.forms.length} form${cover.forms.length === 1 ? '' : 's'}${caught}`;
        head.appendChild(meta);
        item.appendChild(head);

        const examples = document.createElement('div');
        examples.className = 'muted lexicon-examples';
        examples.textContent = (entry.en || []).join(' · ');
        if (examples.textContent) item.appendChild(examples);

        const forms = document.createElement('div');
        forms.className = 'lexicon-forms';
        for (const [form, count] of entry.forms.slice(0, 8)) {
          const label = [foreign(form), document.createTextNode(` ${formatCellNumber(count)}`)];
          forms.appendChild(button('lexicon-form', label, `Insert only this written form (${ngramGloss(form)})`, () => {
            insert(form, 'exact');
            close();
          }));
        }
        if (entry.forms.length > 8) {
          const more = document.createElement('span');
          more.className = 'muted';
          more.textContent = `+ ${entry.forms.length - 8} more`;
          forms.appendChild(more);
        }
        if (entry.root) {
          const family = rootEntries(entry.root);
          if (family.length > 1) {
            const rootCover = coverage(family);
            const label = [document.createTextNode('whole root '), foreign(Array.from(entry.root).join(' ')),
              document.createTextNode(` ${formatCellNumber(family.reduce((sum, e) => sum + e.n, 0))}`)];
            forms.appendChild(button('lexicon-form lexicon-root', label,
              `Insert a pattern matching every word from this root (${family.length} words, ${rootCover.forms.length} forms)`, () => {
                insert(buildFormsRegex(rootCover.forms), 'regex');
                close();
              }));
          }
        }
        item.appendChild(forms);
        results.appendChild(item);
      }
    }
    input.addEventListener('input', debounce(render, 120));
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = results.querySelector('.lexicon-insert');
        if (first) first.click();
      }
    });
    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) close();
    });
  }

  window.contabulateGlossary = {
    init, available, hasRoots, ngramGloss, ngramLemma, ngramRoot, formLemmas, search, summary,
    coverage, rootEntries, formsOf, buildFormsRegex, wireLookup,
  };
})();
