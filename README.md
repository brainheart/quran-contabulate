# Quran Contabulate

A static [Contabulate](https://contabulate.org/) instance for the Quran in
Arabic: a sortable, filterable table of all 114 suras and 6,236 verses, by
period, sura, section, verse, word, bigram, and trigram, with search-term and
text-metric columns. Canonical URL: https://quran.contabulate.org/

- Text: the [Tanzil Project](https://tanzil.net/)'s Quran text (Simple edition,
  version 1.1), shown verbatim with its vowel marks and pause signs.
- Search runs on a search form of the Arabic: vowel marks, recitation signs,
  and tatweel are dropped, and alef wasla is read as plain alef. Other letters
  are matched as written. The build checks this form against Tanzil's own
  unvocalized Simple Clean edition; they agree on every verse.
- Hierarchy: period (the Meccan or Medinan label of a sura) → sura → section
  (the traditional *rukūʿ* divisions) → verse. Locations look like
  `002.Baqarah.§34.255`.
- The unnumbered basmala before a sura is a heading, not a row, and is not
  counted. It is counted where it is a numbered verse (1:1) or part of one
  (27:30).
- Each verse carries Pickthall's 1930 English as a reading aid. It is not
  indexed; the English column can be filtered in the Verse view.
- “Words/Pause” replaces the sentence-length metric of other instances: the
  Arabic has no sentence punctuation, so the build counts stretches between
  recitation pauses.
- Sources, numbering, and counting rules: `docs/sources.html`.

## Build and test

```sh
python3 build.py                     # regenerates docs/data, docs/lines, docs/instance.json
python3 -m unittest discover -v      # corpus, numbering, search form, metadata checks
npm ci && npx playwright test        # browser tests against python3 -m http.server 8793
```

Generated files under `docs/data`, `docs/lines`, and `docs/instance.json` are
build output; edit `scripts/source.py`, `build.py`, or `instance-meta.json` and
rebuild. The source files in `source_text/tanzil` are pinned by SHA-256
(`scripts/source.py`, `source_text/provenance.json`).

## License

Code: MIT (see `LICENSE`).

Arabic text: © 2007–2026 Tanzil Project, Creative Commons Attribution 3.0.
Tanzil permits verbatim copies only and asks for attribution and a link to
tanzil.net; see `source_text/TANZIL-NOTICE.txt`, which the build also copies
next to the generated data. Do not edit verse text.

English: Mohammed Marmaduke Pickthall, *The Meaning of the Glorious Koran*
(1930), in the text Tanzil distributes as `en.pickthall` for non-commercial
use.
