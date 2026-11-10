# Quran Contabulate

Independent static instance (Tanzil Simple text, version 1.1). Run
`python3 build.py`, `python3 -m unittest discover -v`, and `npx playwright test`.
Source files are pinned and checked by SHA-256. Generated files in `docs/data`,
`docs/lines`, and `docs/instance.json` must be rebuilt, not edited.

- Verse text is shown verbatim: Tanzil's license forbids changing it. Never
  normalize, trim, or re-order marks in `text`; normalization belongs to the
  search form only (`normalize` in `build.py`, `stripArabicMarks` in
  `docs/js/utils.js`). Keep those two in lockstep; a test hashes both over the
  whole corpus.
- The source text stacks vowel marks in a non-canonical order. Compare Arabic
  literals in tests through NFC, not byte for byte.
- The unnumbered basmala before a sura is not a row and is not counted.
- Sections are Tanzil's rukūʿ boundaries; locations are
  `SSS.Abbr.§RR.VVV`. Sura names and meanings are curated in `scripts/source.py`.
- The English gloss is display-only. Do not index it.
- `docs/data/glossary.json` (word glosses, lemmas, roots) is built by
  `scripts/glossary.py` from the Quranic Arabic Corpus files in
  `source_text/qac`, pinned by commit and SHA-256. It is a reading aid: the
  page must keep working when it fails to load, and nothing in it may change a
  count. The corpus annotates Uthmani words; the alignment to the Simple text
  must account for exactly 370 split words.
- `created` in `instance-meta.json` stays 2026-11-10.
