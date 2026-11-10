"""Word-level English glosses, lemmas, and roots from the Quranic Arabic Corpus.

The corpus annotates the Uthmani text, one record per word (77,429 words).
This instance shows Tanzil's Simple text, which writes a few hundred words
apart that the Uthmani spelling joins, above all the vocative particle. The
loader aligns the two verse by verse so that every word of the displayed text
receives the gloss, lemmas, and roots of the corpus word it belongs to.
"""
import hashlib
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

QAC_DIR = "qac"
QAC_COMMIT = "17a9062416eccc332111ef3e84f74072d709e187"
QAC_BASE = f"https://raw.githubusercontent.com/kaisdukes/quranic-corpus-api/{QAC_COMMIT}/src/main/resources/data/"
QAC_FILES = {
    # name: (sha256, path under QAC_BASE)
    "word-by-word.txt": ("f732efe12ed56c36c2f94525ed28f4b4e9a4290bdf31a2640bc210d6a9e015d5", "translation/word-by-word.txt"),
    "morphology.txt": ("f1d3417be9aac22d54fff9ddc34db0818d7f490d836471a0d9163b3a2c11c065", "morphology.txt"),
    "lemmas.txt": ("631fd141d1a0d7b771b638bf8a30a73c97391e5086af98978b9260062cf1ee04", "lemmas.txt"),
    "quran-uthmani.xml": ("caeeb8784961f66183efaf7ec86448c65e7a1536ca4204158a972a897b8420be", "quran-uthmani.xml"),
}
WORD_COUNT = 77429

# The corpus's extended Buckwalter transliteration.
BUCKWALTER = {
    "'": "ء", ">": "أ", "<": "إ", "&": "ؤ", "}": "ئ", "|": "آ", "A": "ا", "b": "ب", "p": "ة",
    "t": "ت", "v": "ث", "j": "ج", "H": "ح", "x": "خ", "d": "د", "*": "ذ", "r": "ر", "z": "ز",
    "s": "س", "$": "ش", "S": "ص", "D": "ض", "T": "ط", "Z": "ظ", "E": "ع", "g": "غ", "_": "ـ",
    "f": "ف", "q": "ق", "k": "ك", "l": "ل", "m": "م", "n": "ن", "h": "ه", "w": "و", "Y": "ى",
    "y": "ي", "F": "ً", "N": "ٌ", "K": "ٍ", "a": "َ", "u": "ُ", "i": "ِ", "~": "ّ", "o": "ْ",
    "`": "ٰ", "{": "ٱ", "^": "ٓ", "#": "ٔ", "@": "۟", '"': "۠", "[": "ۢ", ";": "ۣ", ",": "ۥ",
    ".": "ۦ", "!": "ۨ", "-": "۪", "+": "۫", "%": "۬", "]": "ۭ", ":": "ۜ",
}
POS_LABELS = {
    "N": "noun", "PN": "name", "ADJ": "adjective", "V": "verb", "P": "preposition", "PRON": "pronoun",
    "DEM": "demonstrative", "REL": "relative", "T": "time adverb", "LOC": "place adverb",
    "CONJ": "conjunction", "NEG": "negative", "COND": "conditional", "INTG": "interrogative",
    "VOC": "vocative", "INL": "initials",
}
# Words too common in glosses to say what a lemma means. They are indexed
# only for lemmas whose glosses contain nothing else.
STOP_WORDS = frozenset("""
a an the and or of to in on for with by from at as is are was were be been it its he she they them
their his her you your we our us i my me him who whom which that this those these then so but not
no will would shall should may might can could do does did have has had o if when what there than
""".split())
SMALL_ALIFS = "ٰ"
ALIGN_DROP = set("اأإآٱء" + "ـ")
ALIGN_MAP = {"ى": "ي", "ؤ": "و", "ئ": "ي", "ة": "ه"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_qac_files(source_path):
    root = Path(source_path) / QAC_DIR
    for name, (expected, _path) in QAC_FILES.items():
        actual = sha256(root / name)
        if actual != expected:
            raise ValueError(f"Source checksum mismatch for {name}: {actual}")


def from_buckwalter(text):
    try:
        arabic = "".join(BUCKWALTER[c] for c in text)
    except KeyError as error:
        raise ValueError(f"Unknown transliteration character in {text!r}") from error
    return unicodedata.normalize("NFC", arabic)


def display_lemma(lemma):
    """A lemma as a reader expects to see it: plain alef for alef wasla, and
    without the doubled first letter the corpus writes after the article."""
    arabic = from_buckwalter(re.sub(r"\d+$", "", lemma)).replace("\u0671", "\u0627")
    return re.sub("^(.[\u064B-\u0650]?)\u0651", "\\1", arabic)


def _is_word(token):
    return any(unicodedata.category(c).startswith("L") for c in token)


def _read_lines(path):
    lines = Path(path).read_text(encoding="utf-8").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def parse_morphology(line):
    """Prefixes plus one or more stems, each with a part of speech and,
    usually, a lemma and a root."""
    prefixes = []
    stems = []
    for field in line.split(" "):
        if field.endswith("+"):
            prefixes.append(field[:-1])
        elif field.startswith("POS:"):
            stems.append({"pos": field[4:], "lemma": None, "root": None})
        elif field.startswith("LEM:") and stems:
            stems[-1]["lemma"] = field[4:]
        elif field.startswith("ROOT:") and stems:
            stems[-1]["root"] = field[5:]
    return prefixes, stems


def load_corpus_words(source_path):
    """Corpus words by verse: [(uthmani word, gloss, prefixes, stems), ...]."""
    root_dir = Path(source_path) / QAC_DIR
    verify_qac_files(source_path)
    glosses = _read_lines(root_dir / "word-by-word.txt")
    morphology = _read_lines(root_dir / "morphology.txt")
    if not (len(glosses) == len(morphology) == WORD_COUNT):
        raise ValueError("Corpus gloss and morphology files must hold one line per word")
    verses = {}
    position = 0
    for sura in ET.parse(root_dir / "quran-uthmani.xml").getroot().findall("sura"):
        for aya in sura.findall("aya"):
            key = (int(sura.get("index")), int(aya.get("index")))
            words = [t for t in aya.get("text").split(" ") if t and _is_word(t)]
            if key == (37, 130):
                # The corpus treats the name written "il yasin" as one word.
                merged = words.index("إِلْ")
                words[merged:merged + 2] = [" ".join(words[merged:merged + 2])]
            records = []
            for word in words:
                prefixes, stems = parse_morphology(morphology[position])
                records.append({"word": word, "gloss": glosses[position], "prefixes": prefixes, "stems": stems})
                position += 1
            verses[key] = records
    if position != WORD_COUNT:
        raise ValueError(f"Uthmani text has {position} words; the corpus annotates {WORD_COUNT}")
    return verses


def _skeleton(word, normalize):
    """A spelling-tolerant form for alignment only: alefs and hamza seats
    differ between the two spellings, consonants do not."""
    out = []
    for ch in normalize(word.replace(SMALL_ALIFS, "")):
        if ch in ALIGN_DROP or not unicodedata.category(ch).startswith("L") or ch in "ۥۦ":
            continue
        out.append(ALIGN_MAP.get(ch, ch))
    return "".join(out)


def _distance(a, b):
    if a == b:
        return 0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def align(corpus_words, simple_tokens, normalize):
    """Group the displayed words under corpus words: one corpus word spans
    one, two, or three displayed words. Returns (spans, cost)."""
    u = [_skeleton(r["word"], normalize) for r in corpus_words]
    s = [_skeleton(t, normalize) for t in simple_tokens]
    n, m = len(u), len(s)
    if n == m:
        return [1] * n, sum(_distance(a, b) for a, b in zip(u, s))
    INF = float("inf")
    best = [[INF] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]
    best[0][0] = 0
    for i in range(1, n + 1):
        for j in range(i, m + 1):
            for span in (1, 2, 3):
                if j - span < i - 1 or best[i - 1][j - span] == INF:
                    continue
                cost = best[i - 1][j - span] + _distance(u[i - 1], "".join(s[j - span:j])) + 0.01 * (span - 1)
                if cost < best[i][j]:
                    best[i][j] = cost
                    back[i][j] = span
    if best[n][m] == INF:
        raise ValueError("No alignment")
    spans = []
    j = m
    for i in range(n, 0, -1):
        spans.append(back[i][j])
        j -= back[i][j]
    spans.reverse()
    return spans, best[n][m]


def clean_gloss(gloss):
    """Drop sentence punctuation and quotation marks around a gloss; keep the
    corpus's parentheses, which mark words implied by the Arabic."""
    text = re.sub(r"\s+", " ", gloss).strip()
    text = text.strip("\"'“”‘’ ")
    text = re.sub(r"[\"“”]", "", text)
    text = re.sub(r"[.,;:!?…-]+$", "", text).strip()
    return text.strip("\"'“”‘’ ")


def gloss_words(gloss, keep_all=False):
    """Lower-case content words of a gloss. Parenthesized words are implied by
    the Arabic rather than said by it, so they are left out when possible."""
    plain = re.sub(r"\([^)]*\)", " ", gloss)
    words = [w for w in re.findall(r"[a-z]+(?:'[a-z]+)?", plain.lower()) if keep_all or w not in STOP_WORDS]
    if words or keep_all:
        return words
    return re.findall(r"[a-z]+(?:'[a-z]+)?", gloss.lower())


def annotate(source_path, lines, tokenize, normalize):
    """For each displayed verse, one annotation per word:
    {gloss, lemmas: [(lemma, pos, root)], shared}. Also returns statistics."""
    corpus = load_corpus_words(source_path)
    annotated = {}
    stats = Counter()
    split_examples = []
    for row in lines:
        key = (row["play_id"], row["scene"])
        tokens = tokenize(row["text"])
        records = corpus[key]
        spans, cost = align(records, tokens, normalize)
        stats["alignment_cost"] += cost
        if cost >= 3:
            stats["high_cost_verses"] += 1
        out = []
        cursor = 0
        for record, span in zip(records, spans):
            group = tokens[cursor:cursor + span]
            cursor += span
            lemmas = [(st["lemma"], st["pos"], st["root"]) for st in record["stems"] if st["lemma"]]
            gloss = clean_gloss(record["gloss"])
            if span == 1:
                out.append({"gloss": gloss, "lemmas": lemmas})
                continue
            stats["split_words"] += 1
            stats["extra_words"] += span - 1
            if "ya" in record["prefixes"] and group[0] in ("يا", "ويا", "فيا"):
                # The vocative particle written apart: it is its own word.
                stats["vocative_splits"] += 1
                out.append({"gloss": "O", "lemmas": [("yaA", "VOC", None)]})
                rest = re.sub(r"^\(?O\)?[!,]? ", "", gloss) or gloss
                for _ in group[1:]:
                    out.append({"gloss": rest, "lemmas": lemmas, "shared": span > 2})
                continue
            if len(split_examples) < 400:
                split_examples.append((key, record["word"], group, gloss))
            for _ in group:
                out.append({"gloss": gloss, "lemmas": lemmas, "shared": True})
        if cursor != len(tokens) or len(out) != len(tokens):
            raise ValueError(f"Alignment lost words in {key}")
        annotated[key] = out
        stats["words"] += len(out)
    return annotated, stats, split_examples


def load_lemma_glosses(source_path):
    """The corpus's dictionary glosses for verb lemmas."""
    out = {}
    for line in _read_lines(Path(source_path) / QAC_DIR / "lemmas.txt"):
        if "\t" in line:
            lemma, gloss = line.split("\t", 1)
            out[lemma] = gloss.strip()
    return out


def top_glosses(glosses, limit):
    """Most frequent glosses, counting differences of capitalization as one
    gloss and showing its most frequent spelling."""
    merged = defaultdict(Counter)
    for gloss, count in glosses.items():
        merged[gloss.lower()][gloss] += count
    ranked = sorted(merged.values(), key=lambda c: (-sum(c.values()), c.most_common(1)[0][0]))
    return [c.most_common(1)[0][0] for c in ranked[:limit]]


def word_index(glosses, limit=14):
    """English words of a lemma's glosses with the number of occurrences
    glossed with each, most frequent first."""
    counts = Counter()
    for gloss, count in glosses.items():
        for word in set(gloss_words(gloss)):
            counts[word] += count
    return [[w, c] for w, c in sorted(counts.items(), key=lambda wc: (-wc[1], wc[0]))[:limit]]


def build_glossary(source_path, lines, tokenize, normalize, max_glosses=4):
    """Aggregate the per-word annotations into a form table and a lemma table."""
    annotated, stats, split_examples = annotate(source_path, lines, tokenize, normalize)
    verb_glosses = load_lemma_glosses(source_path)
    form_glosses = defaultdict(Counter)
    form_lemmas = defaultdict(Counter)
    form_total = Counter()
    lemma_info = {}
    lemma_glosses = defaultdict(Counter)
    lemma_forms = defaultdict(Counter)
    lemma_pos = defaultdict(Counter)
    for row in lines:
        tokens = tokenize(row["text"])
        for token, note in zip(tokens, annotated[(row["play_id"], row["scene"])]):
            form_total[token] += 1
            form_glosses[token][note["gloss"]] += 1
            for lemma, pos, root in note["lemmas"]:
                # The corpus tags one lemma now as noun, now as adjective;
                # a dictionary entry covers both.
                key = (lemma, "N" if pos == "ADJ" else pos)
                lemma_pos[key][pos] += 1
                info = lemma_info.setdefault(key, {"roots": Counter()})
                if root:
                    info["roots"][root] += 1
                form_lemmas[token][key] += 1
                lemma_forms[key][token] += 1
                # A gloss shared by several lemmas or words describes the
                # whole group, so it counts for the form but not the lemma.
                if len(note["lemmas"]) == 1 and not note.get("shared"):
                    lemma_glosses[key][note["gloss"]] += 1

    ordered = sorted(lemma_forms, key=lambda k: (-sum(lemma_forms[k].values()), k))
    index = {key: i for i, key in enumerate(ordered)}
    lemmas = []
    for key in ordered:
        lemma = key[0]
        pos = lemma_pos[key].most_common(1)[0][0]
        roots = lemma_info[key]["roots"]
        root = from_buckwalter(roots.most_common(1)[0][0]) if roots else ""
        glosses = lemma_glosses[key] or Counter(
            {g: c for form in lemma_forms[key] for g, c in form_glosses[form].items()})
        entry = {
            "ar": "يَا" if lemma == "yaA" and pos == "VOC" else display_lemma(lemma),
            "pos": POS_LABELS.get(pos, "particle"),
            "root": root,
            "n": sum(lemma_forms[key].values()),
            "en": top_glosses(glosses, max_glosses),
            "w": word_index(glosses),
            "forms": [[f, c] for f, c in sorted(lemma_forms[key].items(), key=lambda fc: (-fc[1], fc[0]))],
        }
        if lemma in verb_glosses and pos == "V":
            entry["def"] = verb_glosses[lemma]
        lemmas.append(entry)
    forms = {}
    for form in sorted(form_total):
        glosses = top_glosses(form_glosses[form], 3)
        related = [index[k] for k, _ in form_lemmas[form].most_common(3)]
        forms[form] = [form_total[form], glosses, related]
    stats["lemmas"] = len(lemmas)
    stats["forms"] = len(forms)
    stats["roots"] = len({e["root"] for e in lemmas if e["root"]})
    return {"forms": forms, "lemmas": lemmas}, stats, split_examples
