"""Corpus integrity, numbering, Arabic search form, and metadata tests."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata
import unittest
import xml.etree.ElementTree as ET

import build
from scripts import source

ROOT = Path(__file__).resolve().parents[1]
BASMALA = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'
DIVINE_NAME = re.compile('^([وفأ]*[بت]?ا?|آ)لله$')


def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


def nfc(text):
    # Literals typed here may order stacked vowel marks differently from the
    # source; canonical ordering makes the comparison about content.
    return unicodedata.normalize('NFC', text)


def total(postings):
    return sum(count for _, count in postings)


class CorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.suras = read('docs/data/plays.json')
        cls.chunks = read('docs/data/chunks.json')
        cls.lines = read('docs/lines/all_lines.json')
        cls.tokens = read('docs/data/tokens.json')
        cls.text = {r['canonical_id']: r['text'] for r in cls.lines}
        cls.by_id = {r['canonical_id']: r for r in cls.chunks}

    def test_source_checksums_and_notice(self):
        provenance = source.verify_source_files(ROOT / 'source_text')
        self.assertEqual(len(provenance['files']), 4)
        self.assertIn('Simple, Version 1.1', provenance['edition'])
        for path in ('docs/lines/NOTICE.txt', 'docs/data/NOTICE.txt'):
            notice = (ROOT / path).read_text(encoding='utf-8')
            self.assertIn('Tanzil Quran Text (Simple, Version 1.1)', notice)
            self.assertIn('License: Creative Commons Attribution 3.0', notice)
            self.assertIn('https://tanzil.net/', notice)

    def test_corpus_totals_and_hierarchy(self):
        self.assertEqual(len(self.suras), 114)
        self.assertEqual(sum(s['num_acts'] for s in self.suras), 556)
        self.assertEqual(len(self.chunks), 6236)
        self.assertEqual(sum(s['total_words'] for s in self.suras), 77800)
        self.assertEqual(len(self.tokens), 14868)
        self.assertEqual(Counter(s['genre'] for s in self.suras), {'Meccan': 86, 'Medinan': 28})
        self.assertEqual(self.suras[0]['location'], '001.Fatihah')
        self.assertEqual(self.suras[-1]['location'], '114.Nas')
        self.assertEqual(len({s['abbr'] for s in self.suras}), 114)
        self.assertEqual(len({s['title'] for s in self.suras}), 114)
        self.assertEqual([r['canonical_id'] for r in self.chunks], [r['canonical_id'] for r in self.lines])
        for key in ('scene_id', 'canonical_id', 'location'):
            self.assertEqual(len({r[key] for r in self.chunks}), len(self.chunks))
        self.assertEqual([r['location'] for r in self.chunks], sorted(r['location'] for r in self.chunks))
        for chunk, line in zip(self.chunks, self.lines):
            self.assertEqual(chunk['scene_id'], line['line_num'])
            self.assertEqual(chunk['location'], line['location'])
            self.assertEqual(chunk['total_words'], len(build.tokenize(line['text'])))
            self.assertEqual(chunk['location'],
                             f"{chunk['play_id']:03d}.{chunk['play_abbr']}.§{chunk['act']:02d}.{chunk['scene']:03d}")
            self.assertEqual(chunk['canonical_id'], f"{chunk['play_id']}:{chunk['scene']}")

    def test_suras_sections_and_verse_numbering(self):
        by_number = {s['play_id']: s for s in self.suras}
        self.assertEqual([s['play_id'] for s in self.suras], list(range(1, 115)))
        self.assertEqual((by_number[2]['title'], by_number[2]['name_ar'], by_number[2]['meaning']),
                         ('Al-Baqarah', 'البقرة', 'The Cow'))
        self.assertEqual({n: by_number[n]['verse_count'] for n in (1, 2, 9, 108, 114)},
                         {1: 7, 2: 286, 9: 129, 108: 3, 114: 6})
        self.assertEqual(by_number[2]['num_acts'], 40)
        self.assertEqual(sorted(s['revelation_order'] for s in self.suras), list(range(1, 115)))
        self.assertEqual(by_number[96]['revelation_order'], 1)
        self.assertEqual((by_number[2]['genre'], by_number[96]['genre']), ('Medinan', 'Meccan'))
        for sura in self.suras:
            rows = [r for r in self.chunks if r['play_id'] == sura['play_id']]
            self.assertEqual([r['scene'] for r in rows], list(range(1, sura['verse_count'] + 1)))
            sections = [r['act'] for r in rows]
            self.assertEqual(sections, sorted(sections))
            self.assertEqual(sorted(set(sections)), list(range(1, sura['num_acts'] + 1)))
        self.assertEqual(self.by_id['2:255']['location'], '002.Baqarah.§34.255')
        self.assertEqual(self.by_id['2:255']['heading'], 'Al-Baqarah 2:255')

    def test_verses_are_verbatim_tanzil_and_basmala_headings_are_not_rows(self):
        root = ET.parse(ROOT / 'source_text/tanzil/quran-simple.xml').getroot()
        published = {f"{s.get('index')}:{a.get('index')}": a.get('text') for s in root for a in s}
        self.assertEqual(self.text, published)
        basmala = nfc(BASMALA)
        self.assertEqual(nfc(self.text['1:1']), basmala)
        self.assertEqual(self.text['2:1'], 'الم')
        self.assertTrue(nfc(self.text['9:1']).startswith(nfc('بَرَاءَةٌ مِّنَ اللَّهِ')))
        self.assertTrue(nfc(self.text['27:30']).endswith(basmala))
        self.assertTrue(nfc(self.text['2:255']).startswith(nfc('اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ')))
        self.assertEqual(nfc(self.text['114:6']), nfc('مِنَ الْجِنَّةِ وَالنَّاسِ'))
        self.assertEqual([s['play_id'] for s in self.suras if not s['has_basmala_heading']], [1, 9])
        self.assertEqual(sum(1 for t in self.text.values() if nfc(t).startswith(basmala)), 1)

    def test_search_form_matches_tanzil_simple_clean(self):
        clean = source.load_clean_verses(ROOT / 'source_text')
        heading = build.tokenize(BASMALA)
        self.assertEqual(heading, ['بسم', 'الله', 'الرحمن', 'الرحيم'])
        for row in self.lines:
            sura, verse = row['play_id'], row['scene']
            expected = clean[(sura, verse)].split()
            if verse == 1 and sura not in (1, 9):
                self.assertEqual(expected[:4], heading)
                expected = expected[4:]
            self.assertEqual(build.tokenize(row['text']), expected, row['canonical_id'])

    def test_arabic_tokens_and_pause_units(self):
        self.assertEqual(build.tokenize('ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ'), ['الحمد', 'لله', 'رب', 'العلمين'])
        self.assertEqual(build.tokenize('الرَّحْمَـٰنِ'), ['الرحمن'])  # tatweel and superscript alef dropped
        self.assertEqual(build.tokenize('لَا رَيْبَ ۛ فِيهِ ۛ هُدًى ۩ ۞'), ['لا', 'ريب', 'فيه', 'هدى'])
        self.assertEqual(build.tokenize('أَنَّ إِنَّ آمَنَ هُدًى رَحْمَةً'), ['أن', 'إن', 'آمن', 'هدى', 'رحمة'])
        word = 'اللَّهُ'
        self.assertEqual(build.tokenize(word), build.tokenize(unicodedata.normalize('NFD', word)))
        self.assertEqual(self.by_id['1:1']['sentence_count'], 1)
        self.assertEqual(self.by_id['2:2']['sentence_count'], 2)  # one pause at either three-dot sign
        self.assertEqual(self.by_id['2:255']['sentence_count'], 9)
        self.assertEqual(sum(c['sentence_count'] for c in self.chunks), 10521)
        for chunk in self.chunks:
            self.assertGreaterEqual(chunk['sentence_count'], 1)

    def test_known_frequencies(self):
        self.assertEqual(total(self.tokens['الله']), 2153)
        self.assertEqual(sum(total(p) for w, p in self.tokens.items() if DIVINE_NAME.match(w)), 2699)
        self.assertEqual(sum(total(p) for w, p in self.tokens.items() if re.match('^[وفبل]*موسى$', w)), 136)
        verse_sura = {c['scene_id']: c['play_id'] for c in self.chunks}
        named = {verse_sura[v] for w, p in self.tokens.items() if DIVINE_NAME.match(w) for v, _ in p}
        self.assertEqual(114 - len(named), 29)
        refrain = read('docs/data/tokens3.json')['فبأي آلاء ربكما']
        self.assertEqual(len(refrain), 31)
        self.assertEqual({verse_sura[v] for v, _ in refrain}, {55})
        for word in self.tokens:
            self.assertEqual(word, build.normalize(word))
            self.assertNotRegex(word, r'[ً-ْٰـٱۖ-ۭ]')

    def test_english_gloss_is_aligned(self):
        gloss = {r['canonical_id']: r['gloss'] for r in self.lines}
        self.assertTrue(all(g.strip() for g in gloss.values()))
        self.assertEqual(gloss['1:2'], 'Praise be to Allah, Lord of the Worlds,')
        self.assertEqual(gloss['2:1'], 'Alif. Lam. Mim.')
        self.assertEqual(gloss['114:6'], 'Of the jinn and of mankind.')

    def test_browser_and_python_tokenizers_agree_on_entire_corpus(self):
        code = """
        global.window = global;
        require('./docs/js/utils.js');
        const fs = require('fs'); const crypto = require('crypto');
        const lines = JSON.parse(fs.readFileSync('./docs/lines/all_lines.json'));
        const stream = lines.map(l => tokenizeLineText(l.text).join(' ')).join('\\n');
        process.stdout.write(crypto.createHash('sha256').update(stream).digest('hex'));
        """
        actual = subprocess.check_output(['node', '-e', code], cwd=ROOT, text=True)
        stream = '\n'.join(' '.join(build.tokenize(row['text'])) for row in self.lines)
        self.assertEqual(actual, hashlib.sha256(stream.encode()).hexdigest())

    def test_postings_totals_do_not_cross_verse_boundaries(self):
        by_id = {r['scene_id']: r for r in self.chunks}
        for n, filename in [(1, 'tokens'), (2, 'tokens2'), (3, 'tokens3')]:
            index = read(f'docs/data/{filename}.json')
            totals = Counter()
            for term, postings in index.items():
                self.assertEqual(len(term.split()), n)
                for scene_id, count in postings:
                    self.assertGreater(count, 0)
                    totals[scene_id] += count
            for scene_id, chunk in by_id.items():
                self.assertEqual(totals[scene_id], max(0, chunk['total_words'] - n + 1))

    def test_metrics_metadata_and_disabled_capabilities(self):
        instance = read('docs/instance.json')
        meta = read('instance-meta.json')
        self.assertEqual(instance['schema'], 1)
        self.assertEqual(instance['id'], 'quran')
        self.assertEqual(instance['created'], '2026-11-10')
        self.assertEqual(instance['language'], 'Arabic')
        self.assertEqual(instance['url'], 'https://quran.contabulate.org/')
        self.assertEqual(instance['source'], 'https://github.com/brainheart/quran-contabulate')
        self.assertEqual((ROOT / 'docs/CNAME').read_text().strip(), 'quran.contabulate.org')
        self.assertEqual(instance['stats'], {
            'texts': 114, 'text_label': 'suras', 'segments': 6236, 'segment_label': 'verses',
            'words': 77800, 'distinct_words': 14868, 'commentaries': 0, 'comments': 0})
        self.assertNotIn('text_label', instance)
        self.assertEqual(instance['sample_queries'], meta['sample_queries'])
        self.assertEqual(len(instance['sample_queries']), 4)
        for sample in instance['sample_queries']:
            self.assertTrue(sample['url'].startswith('https://quran.contabulate.org/?'))
        self.assertEqual(sum(c['hapax_count'] for c in self.chunks),
                         sum(total(p) == 1 for p in self.tokens.values()))
        for chunk in self.chunks:
            self.assertGreater(chunk['char_count'], 0)
            self.assertGreater(chunk['rarity_sum'], 0)
            self.assertNotIn('commentary_interest', chunk)
        for sura in self.suras:
            self.assertTrue(0 < sura['mattr_50'] <= 1)
        self.assertEqual(read('docs/data/characters.json'), [])
        self.assertFalse(read('docs/data/character_name_filter_config.json')['enabled'])


if __name__ == '__main__':
    unittest.main()
