import datetime
import json
import math
import re
import unicodedata
from pathlib import Path

from scripts.glossary import QAC_COMMIT, build_glossary
from scripts.source import (  # noqa: F401
    EDITION, GLOSS_LABEL, count_pause_units, load_clean_verses, load_suras, verify_source_files,
)

ROOT = Path(__file__).resolve().parent
TATWEEL = "ـ"
ALEF_WASLA, ALEF = "ٱ", "ا"
TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
SECTION_SIGN = "§"


def normalize(text):
    """Search form of Arabic text: vowel marks, recitation signs, and tatweel
    dropped; alef wasla written as plain alef. Letters, including the hamza
    forms, alef maksura and ta marbuta, are kept as written. Mirrors
    `normalizeTerm` in docs/js/utils.js."""
    text = unicodedata.normalize("NFC", text or "")
    text = "".join(c for c in text if c != TATWEEL and not unicodedata.category(c).startswith("M"))
    return text.replace(ALEF_WASLA, ALEF).lower()


def tokenize(text):
    return TOKEN_RE.findall(normalize(text))


def mattr(tokens, window=50):
    """Moving-average type-token ratio: lexical diversity comparable across lengths."""
    if not tokens:
        return 0.0
    if len(tokens) < window:
        return len(set(tokens)) / len(tokens)
    ratios = [
        len(set(tokens[i:i + window])) / window
        for i in range(len(tokens) - window + 1)
    ]
    return sum(ratios) / len(ratios)


def clean_dir_json_files(path):
    path.mkdir(parents=True, exist_ok=True)
    for json_path in path.glob("*.json"):
        json_path.unlink()


def format_location(sura, abbr, section=None, verse=None):
    """Sortable location: 002.Baqarah, 002.Baqarah.§35, 002.Baqarah.§35.255."""
    location = f"{int(sura):03d}.{abbr}"
    if section is not None:
        location = f"{location}.{SECTION_SIGN}{int(section):02d}"
    if verse is not None:
        location = f"{location}.{int(verse):03d}"
    return location


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def build(source_path: Path, out_dir: Path):
    suras = load_suras(source_path)

    data_dir = out_dir / "data"
    lines_dir = out_dir / "lines"
    clean_dir_json_files(data_dir)
    clean_dir_json_files(lines_dir)

    plays = []
    chunks = []
    all_lines = []
    tokens = {}
    tokens2 = {}
    tokens3 = {}
    verse_id = 0

    for sura in suras:
        sura_id = sura["number"]
        abbr = sura["abbr"]
        title = sura["name"]
        genre = sura["revelation"]
        sura_total_words = 0
        sura_tokens = []  # ordered token stream for sura-level MATTR

        for verse in sura["verses"]:
            text = verse["text"]
            toks = tokenize(text)
            if not toks:
                raise ValueError(f"Verse without tokens: {sura_id}:{verse['verse']}")
            verse_id += 1
            verse_num = verse["verse"]
            section = verse["section"]
            canonical_id = f"{sura_id}:{verse_num}"
            location = format_location(sura_id, abbr, section, verse_num)
            total_words = len(toks)
            sura_total_words += total_words
            sura_tokens.extend(toks)

            chunks.append({
                "scene_id": verse_id,
                "canonical_id": canonical_id,
                "location": location,
                "play_id": sura_id,
                "play_title": title,
                "play_abbr": abbr,
                "genre": genre,
                "act": section,
                "scene": verse_num,
                "heading": f"{title} {canonical_id}",
                "total_words": total_words,
                "unique_words": len(set(toks)),
                "num_speeches": 0,
                "num_lines": 1,
                "verse_count": 1,
                "characters_present_count": 0,
                # Pause units stand in for sentences: the text has no
                # sentence punctuation, only recitation pause marks.
                "sentence_count": count_pause_units(text, tokenize),
            })
            all_lines.append({
                "play_id": sura_id,
                "canonical_id": canonical_id,
                "location": location,
                "act": section,
                "scene": verse_num,
                "line_num": verse_id,
                "speaker": "",
                "text": text,
                "gloss": verse["gloss"],
            })

            for n, index in ((1, tokens), (2, tokens2), (3, tokens3)):
                counts = {}
                for idx in range(len(toks) - n + 1):
                    term = " ".join(toks[idx:idx + n])
                    counts[term] = counts.get(term, 0) + 1
                for term, count in counts.items():
                    index.setdefault(term, []).append([verse_id, count])

        plays.append({
            "play_id": sura_id,
            "location": format_location(sura_id, abbr),
            "title": title,
            "abbr": abbr,
            "name_ar": sura["name_ar"],
            "meaning": sura["meaning"],
            "genre": genre,
            "revelation_order": sura["revelation_order"],
            "has_basmala_heading": bool(sura["basmala"]),
            "first_performance_year": None,
            "num_acts": sura["sections"],
            "num_scenes": len(sura["verses"]),
            "num_speeches": 0,
            "total_words": sura_total_words,
            "total_lines": len(sura["verses"]),
            "verse_count": len(sura["verses"]),
            "mattr_50": round(mattr(sura_tokens), 3),
        })

    # Additive metric fields (char_count, rarity_sum, hapax_count) per verse.
    # The UI derives ratio metrics at any aggregation level by summing these
    # and dividing by total words.
    corpus_freq = {tok: sum(c for _, c in postings) for tok, postings in tokens.items()}
    corpus_total = sum(corpus_freq.values()) or 1
    tok_rarity = {tok: -math.log10(f / corpus_total) for tok, f in corpus_freq.items()}
    verse_chars, verse_rarity, verse_hapax = {}, {}, {}
    for tok, postings in tokens.items():
        length = len(tok)
        rarity = tok_rarity[tok]
        is_hapax = corpus_freq[tok] == 1
        for vid, count in postings:
            verse_chars[vid] = verse_chars.get(vid, 0) + length * count
            verse_rarity[vid] = verse_rarity.get(vid, 0.0) + rarity * count
            if is_hapax:
                verse_hapax[vid] = verse_hapax.get(vid, 0) + count
    for chunk_row in chunks:
        vid = chunk_row["scene_id"]
        chunk_row["char_count"] = verse_chars.get(vid, 0)
        chunk_row["rarity_sum"] = round(verse_rarity.get(vid, 0.0), 3)
        chunk_row["hapax_count"] = verse_hapax.get(vid, 0)

    instance_meta = json.loads((ROOT / "instance-meta.json").read_text(encoding="utf-8"))
    instance_payload = {
        "schema": 1,
        **instance_meta,
        "updated": datetime.date.today().isoformat(),
        "stats": {
            "texts": len(plays),
            "text_label": instance_meta.get("text_label", "suras"),
            "segments": len(chunks),
            "segment_label": instance_meta.get("segment_label", "verses"),
            "words": sum(p["total_words"] for p in plays),
            "distinct_words": len(tokens),
            "commentaries": 0,
            "comments": 0,
        },
    }
    instance_payload.pop("text_label", None)
    instance_payload.pop("segment_label", None)
    (out_dir / "instance.json").write_text(
        json.dumps(instance_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    write_json(data_dir / "plays.json", plays)
    write_json(data_dir / "chunks.json", chunks)
    write_json(data_dir / "characters.json", [])
    write_json(data_dir / "tokens.json", tokens)
    write_json(data_dir / "tokens2.json", tokens2)
    write_json(data_dir / "tokens3.json", tokens3)
    write_json(data_dir / "tokens_char.json", {})
    write_json(data_dir / "tokens_char2.json", {})
    write_json(data_dir / "tokens_char3.json", {})
    write_json(data_dir / "commentary_interest.json", {
        "metadata": {"commentators": []},
        "summary": {"note": "No commentary is attached to this corpus yet.",
                    "total_commentators": 0, "verses_with_interest": 0, "total_interest": 0},
    })
    write_json(data_dir / "character_name_filter_config.json", {
        "enabled": False,
        "notes": ["Disabled: this corpus does not yet have a reviewed proper-name list."],
        "global_additions": [],
        "global_removals": [],
        "play_additions": {},
        "play_removals": {},
    })
    write_json(lines_dir / "all_lines.json", all_lines)
    # English glosses, lemmas, and roots for every word form (reading aids).
    glossary, glossary_stats, _ = build_glossary(source_path, all_lines, tokenize, normalize)
    write_json(data_dir / "glossary.json", {
        "source": "Quranic Arabic Corpus (https://corpus.quran.com), word-by-word translation and "
                  f"morphology, kaisdukes/quranic-corpus-api@{QAC_COMMIT[:7]}; GNU GPL",
        "meta": {"lang": "ar", "dir": "rtl"},
        **glossary,
    })
    # Tanzil asks that its notice travel with files derived from the text.
    notice = (ROOT / "source_text" / "TANZIL-NOTICE.txt").read_text(encoding="utf-8")
    (lines_dir / "NOTICE.txt").write_text(notice, encoding="utf-8")
    (data_dir / "NOTICE.txt").write_text(notice, encoding="utf-8")

    return {
        "sura_count": len(plays),
        "section_count": sum(p["num_acts"] for p in plays),
        "verse_count": len(chunks),
        "word_count": instance_payload["stats"]["words"],
        "distinct_words": len(tokens),
        "lemmas": glossary_stats["lemmas"],
        "roots": glossary_stats["roots"],
        "split_words": glossary_stats["split_words"],
        "vocative_splits": glossary_stats["vocative_splits"],
    }


if __name__ == "__main__":
    source_path = ROOT / "source_text"
    out_dir = ROOT / "docs"
    print(f"Building from {source_path} -> {out_dir}")
    result = build(source_path, out_dir)
    print(
        "Done: "
        f"{result['sura_count']} suras, {result['section_count']} sections, "
        f"{result['verse_count']} verses, {result['word_count']} words, "
        f"{result['distinct_words']} distinct words; glossary: "
        f"{result['lemmas']} lemmas, {result['roots']} roots"
    )
