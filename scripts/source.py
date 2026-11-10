"""Pinned Tanzil sources for the Quran instance: text, structure, and gloss.

The Arabic text is the Tanzil Project's Simple edition (CC BY 3.0, verbatim
copies only). Nothing here alters a verse: the loader reads each `aya` text
exactly as published and keeps the unnumbered basmala that precedes a sura
out of the verse, as the edition itself does in its XML form.
"""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

TANZIL_DIR = "tanzil"
FILES = {
    # name: (sha256, download URL)
    "quran-simple.xml": (
        "f65540c630e7c645140323881de45cc3f5aebbd2b08720eb63ec06cf757f6fe9",
        "https://tanzil.net/pub/download/index.php?quranType=simple&outType=xml&agree=true&marks=true&sajdah=true&rub=true",
    ),
    "quran-simple-clean.txt": (
        "228df2a717671aeb9d2ff573002bd28d6b3f973f4bc7153554e3a81663d67610",
        "https://tanzil.net/pub/download/index.php?quranType=simple-clean&outType=txt-2&agree=true",
    ),
    "quran-data.xml": (
        "8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a",
        "https://tanzil.net/res/text/metadata/quran-data.xml",
    ),
    "en.pickthall.txt": (
        "4aabbfa9d96796f5a6b0217d2c39dce1a3084f772bf6f2650e37082a774e3cc7",
        "https://tanzil.net/trans/en.pickthall",
    ),
}
EDITION = "Tanzil Quran Text (Simple, Version 1.1)"
GLOSS_LABEL = "Pickthall 1930"

# Recitation pauses that end a pause unit: obligatory, permissible, and the
# two "preferred" marks. The "do not stop" sign (U+06D9) and the brief
# breathless saktah (U+06DC) are not pauses; the paired three-dot signs
# (U+06DB) mark one pause taken at either place, so a pair counts once.
PAUSE_MARKS = "\u06D6\u06D7\u06D8\u06DA"
PAIRED_PAUSE_MARK = "\u06DB"

# Conventional transliterated sura names and English glosses, curated for this
# instance: (name, location abbreviation, meaning). Arabic names, verse
# counts, revelation place and order come from Tanzil's metadata.
SURAS = [
    ("Al-Fatihah", "Fatihah", "The Opening"),
    ("Al-Baqarah", "Baqarah", "The Cow"),
    ("Ali 'Imran", "AliImran", "The Family of Imran"),
    ("An-Nisa", "Nisa", "The Women"),
    ("Al-Ma'idah", "Maidah", "The Table Spread"),
    ("Al-An'am", "Anam", "The Cattle"),
    ("Al-A'raf", "Araf", "The Heights"),
    ("Al-Anfal", "Anfal", "The Spoils of War"),
    ("At-Tawbah", "Tawbah", "The Repentance"),
    ("Yunus", "Yunus", "Jonah"),
    ("Hud", "Hud", "Hud"),
    ("Yusuf", "Yusuf", "Joseph"),
    ("Ar-Ra'd", "Rad", "The Thunder"),
    ("Ibrahim", "Ibrahim", "Abraham"),
    ("Al-Hijr", "Hijr", "The Rocky Tract"),
    ("An-Nahl", "Nahl", "The Bee"),
    ("Al-Isra", "Isra", "The Night Journey"),
    ("Al-Kahf", "Kahf", "The Cave"),
    ("Maryam", "Maryam", "Mary"),
    ("Ta-Ha", "TaHa", "Ta-Ha"),
    ("Al-Anbiya", "Anbiya", "The Prophets"),
    ("Al-Hajj", "Hajj", "The Pilgrimage"),
    ("Al-Mu'minun", "Muminun", "The Believers"),
    ("An-Nur", "Nur", "The Light"),
    ("Al-Furqan", "Furqan", "The Criterion"),
    ("Ash-Shu'ara", "Shuara", "The Poets"),
    ("An-Naml", "Naml", "The Ant"),
    ("Al-Qasas", "Qasas", "The Stories"),
    ("Al-'Ankabut", "Ankabut", "The Spider"),
    ("Ar-Rum", "Rum", "The Romans"),
    ("Luqman", "Luqman", "Luqman"),
    ("As-Sajdah", "Sajdah", "The Prostration"),
    ("Al-Ahzab", "Ahzab", "The Confederates"),
    ("Saba", "Saba", "Sheba"),
    ("Fatir", "Fatir", "The Originator"),
    ("Ya-Sin", "YaSin", "Ya-Sin"),
    ("As-Saffat", "Saffat", "Those Ranged in Ranks"),
    ("Sad", "Sad", "Sad"),
    ("Az-Zumar", "Zumar", "The Throngs"),
    ("Ghafir", "Ghafir", "The Forgiver"),
    ("Fussilat", "Fussilat", "Explained in Detail"),
    ("Ash-Shura", "Shura", "The Consultation"),
    ("Az-Zukhruf", "Zukhruf", "The Gold Adornments"),
    ("Ad-Dukhan", "Dukhan", "The Smoke"),
    ("Al-Jathiyah", "Jathiyah", "The Kneeling"),
    ("Al-Ahqaf", "Ahqaf", "The Sand Dunes"),
    ("Muhammad", "Muhammad", "Muhammad"),
    ("Al-Fath", "Fath", "The Victory"),
    ("Al-Hujurat", "Hujurat", "The Private Chambers"),
    ("Qaf", "Qaf", "Qaf"),
    ("Adh-Dhariyat", "Dhariyat", "The Scattering Winds"),
    ("At-Tur", "Tur", "The Mount"),
    ("An-Najm", "Najm", "The Star"),
    ("Al-Qamar", "Qamar", "The Moon"),
    ("Ar-Rahman", "Rahman", "The Most Merciful"),
    ("Al-Waqi'ah", "Waqiah", "The Inevitable Event"),
    ("Al-Hadid", "Hadid", "Iron"),
    ("Al-Mujadilah", "Mujadilah", "The Pleading Woman"),
    ("Al-Hashr", "Hashr", "The Gathering"),
    ("Al-Mumtahanah", "Mumtahanah", "The Woman Examined"),
    ("As-Saff", "Saff", "The Ranks"),
    ("Al-Jumu'ah", "Jumuah", "Friday"),
    ("Al-Munafiqun", "Munafiqun", "The Hypocrites"),
    ("At-Taghabun", "Taghabun", "Mutual Loss and Gain"),
    ("At-Talaq", "Talaq", "Divorce"),
    ("At-Tahrim", "Tahrim", "The Prohibition"),
    ("Al-Mulk", "Mulk", "The Sovereignty"),
    ("Al-Qalam", "Qalam", "The Pen"),
    ("Al-Haqqah", "Haqqah", "The Inevitable Reality"),
    ("Al-Ma'arij", "Maarij", "The Ascending Stairways"),
    ("Nuh", "Nuh", "Noah"),
    ("Al-Jinn", "Jinn", "The Jinn"),
    ("Al-Muzzammil", "Muzzammil", "The Enshrouded One"),
    ("Al-Muddaththir", "Muddaththir", "The Cloaked One"),
    ("Al-Qiyamah", "Qiyamah", "The Resurrection"),
    ("Al-Insan", "Insan", "Man"),
    ("Al-Mursalat", "Mursalat", "Those Sent Forth"),
    ("An-Naba", "Naba", "The Tidings"),
    ("An-Nazi'at", "Naziat", "Those Who Pull Out"),
    ("'Abasa", "Abasa", "He Frowned"),
    ("At-Takwir", "Takwir", "The Folding Up"),
    ("Al-Infitar", "Infitar", "The Cleaving"),
    ("Al-Mutaffifin", "Mutaffifin", "The Defrauders"),
    ("Al-Inshiqaq", "Inshiqaq", "The Splitting Open"),
    ("Al-Buruj", "Buruj", "The Constellations"),
    ("At-Tariq", "Tariq", "The Night-Comer"),
    ("Al-A'la", "Ala", "The Most High"),
    ("Al-Ghashiyah", "Ghashiyah", "The Overwhelming"),
    ("Al-Fajr", "Fajr", "The Dawn"),
    ("Al-Balad", "Balad", "The City"),
    ("Ash-Shams", "Shams", "The Sun"),
    ("Al-Layl", "Layl", "The Night"),
    ("Ad-Duha", "Duha", "The Morning Brightness"),
    ("Ash-Sharh", "Sharh", "The Opening of the Breast"),
    ("At-Tin", "Tin", "The Fig"),
    ("Al-'Alaq", "Alaq", "The Clinging Clot"),
    ("Al-Qadr", "Qadr", "The Night of Decree"),
    ("Al-Bayyinah", "Bayyinah", "The Clear Evidence"),
    ("Az-Zalzalah", "Zalzalah", "The Earthquake"),
    ("Al-'Adiyat", "Adiyat", "The Chargers"),
    ("Al-Qari'ah", "Qariah", "The Striking Calamity"),
    ("At-Takathur", "Takathur", "Rivalry in Worldly Increase"),
    ("Al-'Asr", "Asr", "Time"),
    ("Al-Humazah", "Humazah", "The Slanderer"),
    ("Al-Fil", "Fil", "The Elephant"),
    ("Quraysh", "Quraysh", "Quraysh"),
    ("Al-Ma'un", "Maun", "Small Kindnesses"),
    ("Al-Kawthar", "Kawthar", "Abundance"),
    ("Al-Kafirun", "Kafirun", "The Disbelievers"),
    ("An-Nasr", "Nasr", "Divine Support"),
    ("Al-Masad", "Masad", "The Palm Fiber"),
    ("Al-Ikhlas", "Ikhlas", "Sincerity"),
    ("Al-Falaq", "Falaq", "The Daybreak"),
    ("An-Nas", "Nas", "Mankind"),
]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_source_files(source_path):
    """Fail loudly if a pinned source file is missing or has changed."""
    root = Path(source_path) / TANZIL_DIR
    for name, (expected, _url) in FILES.items():
        actual = sha256(root / name)
        if actual != expected:
            raise ValueError(f"Source checksum mismatch for {name}: {actual}")
    provenance = json.loads((Path(source_path) / "provenance.json").read_text(encoding="utf-8"))
    recorded = {f["name"]: f["sha256"] for f in provenance["files"]}
    if recorded != {name: digest for name, (digest, _url) in FILES.items()}:
        raise ValueError("source_text/provenance.json disagrees with scripts/source.py")
    return provenance


def _read_pipe_file(path):
    """Tanzil `sura|aya|text` files; a `#` comment block follows the data."""
    rows = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        sura, aya, text = line.split("|", 2)
        rows[(int(sura), int(aya))] = text
    return rows


def load_metadata(source_path):
    root = ET.parse(Path(source_path) / TANZIL_DIR / "quran-data.xml").getroot()
    suras = [
        {
            "number": int(el.get("index")),
            "verses": int(el.get("ayas")),
            "name_ar": el.get("name"),
            "revelation": el.get("type"),
            "revelation_order": int(el.get("order")),
            "sections": int(el.get("rukus")),
        }
        for el in root.find("suras")
    ]
    section_starts = {}
    for el in root.find("rukus"):
        section_starts.setdefault(int(el.get("sura")), []).append(int(el.get("aya")))
    return suras, section_starts


def count_pause_units(text, tokenize):
    """Stretches of words between recitation pauses; a verse end is a pause."""
    marked = re.sub(f"[{PAUSE_MARKS}]", "\n", text)
    # The first of a three-dot pair is skipped, the second ends the unit.
    marked = re.sub(f"{PAIRED_PAUSE_MARK}([^{PAIRED_PAUSE_MARK}]*){PAIRED_PAUSE_MARK}", "\\1\n", marked)
    return sum(1 for part in marked.split("\n") if tokenize(part))


def load_suras(source_path):
    """Return the 114 suras in mushaf order with verses, sections, and gloss."""
    source_path = Path(source_path)
    verify_source_files(source_path)
    meta, section_starts = load_metadata(source_path)
    gloss = _read_pipe_file(source_path / TANZIL_DIR / "en.pickthall.txt")
    root = ET.parse(source_path / TANZIL_DIR / "quran-simple.xml").getroot()
    sura_elements = root.findall("sura")
    if not (len(sura_elements) == len(meta) == len(SURAS) == 114):
        raise ValueError("Expected 114 suras in text, metadata, and name catalog")

    suras = []
    for el, info, (name, abbr, meaning) in zip(sura_elements, meta, SURAS):
        number = int(el.get("index"))
        if number != info["number"] or el.get("name") != info["name_ar"]:
            raise ValueError(f"Sura {number}: text and metadata disagree")
        starts = section_starts[number]
        if starts[0] != 1 or starts != sorted(set(starts)) or len(starts) != info["sections"]:
            raise ValueError(f"Sura {number}: unexpected section boundaries")
        verses = []
        section = 0
        for position, aya in enumerate(el.findall("aya"), start=1):
            verse = int(aya.get("index"))
            if verse != position:
                raise ValueError(f"Sura {number}: verse {verse} out of order")
            if section < len(starts) and verse == starts[section]:
                section += 1
            verses.append({
                "sura": number,
                "verse": verse,
                "section": section,
                "text": aya.get("text"),
                "gloss": gloss[(number, verse)],
            })
        if len(verses) != info["verses"]:
            raise ValueError(f"Sura {number}: {len(verses)} verses, metadata says {info['verses']}")
        suras.append({
            **info,
            "name": name,
            "abbr": abbr,
            "meaning": meaning,
            # The basmala printed before every sura but 1 (where it is verse
            # 1) and 9 (which has none) is a heading, not a numbered verse.
            "basmala": el.find("aya").get("bismillah") or "",
            "verses": verses,
        })
    if len(gloss) != sum(len(s["verses"]) for s in suras):
        raise ValueError("Gloss verse count differs from the Arabic text")
    return suras


def load_clean_verses(source_path):
    """Tanzil's own diacritic-free text, used only to check our normalization."""
    return _read_pipe_file(Path(source_path) / TANZIL_DIR / "quran-simple-clean.txt")
