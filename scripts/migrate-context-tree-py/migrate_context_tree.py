#!/usr/bin/env python3
"""
ENG-2834 — Markdown-to-HTML context-tree migration script.

One-shot, offline, no-daemon migrator that converts a project's
`.brv/context-tree/` from Markdown topic files to `<bv-topic>` HTML
documents matching the format `proj/html-mem-conversion`'s curate
flow writes today.

Scope (per the Linear ticket): walk `.brv/context-tree/`, route every
entry into one of four outcomes:
  - topic .md  -> emit `.html` + archive the source `.md`
  - derived    -> archive without emitting HTML (no HTML equivalent
                  for `_index.md`, `.abstract.md`, `.overview.md`,
                  `_manifest.json` in the current pipeline)
  - archived/  -> skip entirely (subtree out of migration scope; no
                  `<bv-archive-stub>` element in the vocabulary)
  - failed     -> archive the source `.md` and mark as failed

After one run the live `.brv/context-tree/` contains zero `.md` files
outside `_archived/`. Every markdown the migrator touches ends up in
either the HTML output (live tree) or the archive — never both, never
lingering in `.brv/context-tree/` as `.md`. The archive root is
`.brv/_migrations/context-tree-md-<YYYY-MM-DD>/`, flat-mirroring the
source tree structure. `--dry-run` runs classification + conversion
in memory only.

Reference: design.md §17 (narrower scope shipped). Mapping rules are
mirrored from the TypeScript curate/HTML writer
(`src/server/infra/render/`) so the migrated topics validate when
read by the existing pipeline.

Usage:
    python migrate_context_tree.py --project-root /path/to/project
    python migrate_context_tree.py --dry-run --project-root .
    python migrate_context_tree.py --rollback --project-root .
"""

from __future__ import annotations

import argparse
import datetime
import re
import shutil
import sys
from pathlib import Path
from typing import Optional, Tuple

import yaml


# =============================================================================
# Constants — mirrored from byterover-cli's TypeScript constants.ts
# =============================================================================

BRV_DIR = ".brv"
CONTEXT_TREE_DIR = "context-tree"
MIGRATIONS_DIR = "_migrations"
ARCHIVE_FOLDER_PREFIX = "context-tree-md-"

ARCHIVE_DIR = "_archived"
SUMMARY_INDEX_FILE = "_index.md"
ABSTRACT_EXTENSION = ".abstract.md"
OVERVIEW_EXTENSION = ".overview.md"
MANIFEST_FILE = "_manifest.json"

# Canonical body sections produced by the markdown writer; everything
# else is treated as an orphan section and preserved as plain HTML.
KNOWN_SECTION_HEADINGS = {"Reason", "Raw Concept", "Narrative", "Facts", "Relations"}

# Diagram type enum from `<bv-diagram type>` schema.
DIAGRAM_TYPES = {"mermaid", "plantuml", "ascii", "dot", "graphviz", "other"}

# Fact category enum from `<bv-fact category>` schema.
FACT_CATEGORIES = {
    "personal",
    "project",
    "preference",
    "convention",
    "team",
    "environment",
    "other",
}


# =============================================================================
# Heuristic-map — pure functions
# =============================================================================


def infer_rule_severity(text: str) -> Optional[str]:
    """Return RFC2119 severity ('must'|'should'|'info') or None when no
    keyword is present. Word boundaries are enforced so 'trust' doesn't
    match MUST. Precedence (must > should > info) handles sentences with
    multiple keywords.
    """
    if re.search(r"\b(MUST|SHALL)\b", text, re.IGNORECASE):
        return "must"
    if re.search(r"\bSHOULD\b", text, re.IGNORECASE):
        return "should"
    if re.search(r"\b(MAY|INFO)\b", text, re.IGNORECASE):
        return "info"
    return None


# Strip RFC2119 keywords from rule text when building an id so the
# slug reflects the rule's content rather than the keyword itself.
_RFC2119_STRIP = re.compile(r"\b(MUST|SHALL|SHOULD|MAY|INFO)\b", re.IGNORECASE)


def slugify_rule_id(text: str, prefix: str) -> str:
    """Generate a stable kebab-case id from rule text. Strips RFC2119
    keywords, normalises to ASCII alphanumerics + hyphens, takes the
    first ~6 words, and prefixes with the supplied marker.

    Returns '<prefix>-rule' for empty/all-stopword input so callers
    always have a non-empty id."""
    cleaned = _RFC2119_STRIP.sub(" ", text).lower()
    cleaned = re.sub(r"[^a-z0-9\s-]", " ", cleaned)
    words = [w for w in cleaned.split() if w]
    words = words[:6]
    if not words:
        return f"{prefix}-rule"
    slug = "-".join(words)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if len(slug) > 48:
        slug = slug[:48].rsplit("-", 1)[0] if "-" in slug[:48] else slug[:48]
    return f"{prefix}-{slug}"


def split_rules_block(rules_text: str) -> list[dict]:
    """Split a markdown `### Rules` block into individual rule entries.
    Recognises bullet lists, numbered lists, and paragraph-separated
    rules (in that priority). Each entry carries `text`, optional
    `severity`, and a unique `id`.
    """
    trimmed = rules_text.strip()
    if not trimmed:
        return []

    lines = [l.strip() for l in trimmed.split("\n") if l.strip()]
    bullets = [l for l in lines if re.match(r"^[-*+]\s+", l)]
    numbered = [l for l in lines if re.match(r"^\d+\.\s+", l)]

    items: list[str]
    if bullets:
        items = [re.sub(r"^[-*+]\s+", "", l) for l in bullets]
    elif numbered:
        items = [re.sub(r"^\d+\.\s+", "", l) for l in numbered]
    else:
        items = [p.strip() for p in re.split(r"\n\s*\n", trimmed) if p.strip()]

    seen_ids: set[str] = set()
    out: list[dict] = []
    for text in items:
        base_id = slugify_rule_id(text, "r")
        rule_id = base_id
        suffix = 2
        while rule_id in seen_ids:
            rule_id = f"{base_id}-{suffix}"
            suffix += 1
        seen_ids.add(rule_id)

        severity = infer_rule_severity(text)
        entry: dict = {"id": rule_id, "text": text}
        if severity is not None:
            entry["severity"] = severity
        out.append(entry)
    return out


def normalize_diagram_type(type_: str) -> str:
    """Collapse a diagram type label to the bv-diagram schema enum.
    Empty input defaults to 'ascii' (the MD writer's historical default
    for unlabelled fenced blocks). Unknown labels collapse to 'other'.
    """
    if not type_:
        return "ascii"
    lowered = type_.lower()
    return lowered if lowered in DIAGRAM_TYPES else "other"


def normalize_fact_category(category: Optional[str]) -> Optional[str]:
    """Collapse a fact category to the bv-fact schema enum, or None
    when input is None so the attribute can be omitted entirely."""
    if category is None:
        return None
    lowered = category.lower()
    return lowered if lowered in FACT_CATEGORIES else "other"


def escape_html_text(s: str) -> str:
    """Entity-encode the five HTML special characters. `&` is escaped
    first so subsequent encodings of `<`/`>`/quotes do not get
    double-encoded.
    """
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def rel_path_to_topic_path(rel_path: str) -> str:
    """Convert `security/auth.md` -> `security/auth`. Normalises
    backslashes; rejects traversal segments so the migrated topic
    passes the HTML writer's path safety check."""
    normalized = rel_path.replace("\\", "/").lstrip("/")
    segments = [s for s in normalized.split("/") if s]
    for seg in segments:
        if seg in ("..", "."):
            raise ValueError(f"Topic path contains unsafe segment '{seg}': {rel_path}")
    joined = "/".join(segments)
    return joined[:-3] if joined.endswith(".md") else joined


_SECTION_REGEX = re.compile(r"^##\s+([^\n]+?)\s*$([\s\S]*?)(?=^##\s|\Z)", re.MULTILINE)


def parse_orphan_sections(body: str) -> list[dict]:
    """Walk a markdown body and return every `## X` section whose
    heading is not in the canonical set."""
    out: list[dict] = []
    for m in _SECTION_REGEX.finditer(body):
        heading = m.group(1).strip()
        if heading in KNOWN_SECTION_HEADINGS:
            continue
        content = m.group(2).strip()
        if not content:
            continue
        out.append({"heading": heading, "content": content})
    return out


# =============================================================================
# Markdown body parsers — mirror MarkdownWriter.parseContent (TS)
# =============================================================================


def _parse_frontmatter(content: str) -> Tuple[Optional[dict], str]:
    """Extract YAML frontmatter from the head of the file. Returns
    (frontmatter_dict, body). When no frontmatter is found, returns
    (None, original_content)."""
    if not (content.startswith("---\n") or content.startswith("---\r\n")):
        return None, content

    # Find the closing --- delimiter.
    lf = content.find("\n---\n", 4)
    crlf = content.find("\r\n---\r\n", 5)
    is_crlf = lf == -1
    end = crlf if is_crlf else lf
    if end < 0:
        return None, content

    delim = 7 if is_crlf else 5
    yaml_block = content[5 if is_crlf else 4 : end]
    body = content[end + delim :]

    try:
        parsed = yaml.safe_load(yaml_block)
    except yaml.YAMLError:
        return None, content
    if not isinstance(parsed, dict):
        return None, content
    return parsed, body


def _str_list(value) -> list[str]:
    return [v for v in (value or []) if isinstance(v, str)]


def _opt_str(value) -> Optional[str]:
    return value if isinstance(value, str) else None


def _parse_section(body: str, heading: str) -> Optional[str]:
    pattern = re.compile(
        rf"##\s*{re.escape(heading)}\s*\n([\s\S]*?)(?=\n##\s|\n---\n|$)",
        re.IGNORECASE,
    )
    m = pattern.search(body)
    if not m:
        return None
    text = m.group(1).strip()
    return text or None


def _parse_reason(body: str) -> Optional[str]:
    return _parse_section(body, "Reason")


def _parse_raw_concept(body: str) -> dict:
    section = _parse_section(body, "Raw Concept")
    if not section:
        return {}
    rc: dict = {}

    m_task = re.search(
        r"\*\*\s*Task\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)", section, re.IGNORECASE
    )
    if m_task:
        rc["task"] = m_task.group(1).strip()

    m_changes = re.search(
        r"\*\*\s*Changes\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)", section, re.IGNORECASE
    )
    if m_changes:
        rc["changes"] = [
            l.strip()[2:]
            for l in m_changes.group(1).split("\n")
            if l.strip().startswith("- ")
        ]

    m_files = re.search(
        r"\*\*\s*Files\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)", section, re.IGNORECASE
    )
    if m_files:
        rc["files"] = [
            l.strip()[2:]
            for l in m_files.group(1).split("\n")
            if l.strip().startswith("- ")
        ]

    m_flow = re.search(
        r"\*\*\s*Flow\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)", section, re.IGNORECASE
    )
    if m_flow:
        rc["flow"] = m_flow.group(1).strip()

    m_timestamp = re.search(r"\*\*\s*Timestamp\s*:\s*\*\*\s*(.+)", section, re.IGNORECASE)
    if m_timestamp:
        rc["timestamp"] = m_timestamp.group(1).strip()

    m_author = re.search(r"\*\*\s*Author\s*:\s*\*\*\s*(.+)", section, re.IGNORECASE)
    if m_author:
        rc["author"] = m_author.group(1).strip()

    m_patterns = re.search(
        r"\*\*\s*Patterns\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)",
        section,
        re.IGNORECASE,
    )
    if m_patterns:
        patterns: list[dict] = []
        for line in m_patterns.group(1).split("\n"):
            if not line.strip().startswith("- `"):
                continue
            pm = re.match(r"- `(.+?)`(?:\s*\(flags:\s*(.+?)\))?\s*-\s*(.+)", line)
            if pm:
                entry = {"pattern": pm.group(1), "description": pm.group(3).strip()}
                if pm.group(2):
                    entry["flags"] = pm.group(2)
                patterns.append(entry)
        if patterns:
            rc["patterns"] = patterns

    return rc


def _parse_narrative(body: str) -> dict:
    # Narrative subsections use `### X` underneath `## Narrative`.
    pattern = re.compile(
        r"##\s*Narrative\s*\n([\s\S]*?)(?=\n##\s[^#]|\n---\n|$)", re.IGNORECASE
    )
    m = pattern.search(body)
    if not m:
        return {}
    section = m.group(1)
    narrative: dict = {}

    def grab(name: str) -> Optional[str]:
        rx = re.compile(
            rf"###\s*{name}\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)", re.IGNORECASE
        )
        sub = rx.search(section)
        return sub.group(1).strip() if sub else None

    if (v := grab("Structure")) is not None:
        narrative["structure"] = v
    if (v := grab("Dependencies")) is not None:
        narrative["dependencies"] = v
    if (v := grab("(?:Highlights|Features)")) is not None:
        narrative["highlights"] = v
    if (v := grab("Rules")) is not None:
        narrative["rules"] = v
    if (v := grab("Examples")) is not None:
        narrative["examples"] = v

    # Diagrams: fenced blocks under `### Diagrams`.
    m_dia = re.search(
        r"###\s*Diagrams\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)", section, re.IGNORECASE
    )
    if m_dia:
        diagrams: list[dict] = []
        for bm in re.finditer(
            r"(?:\*\*(.+?)\*\*\n)?```(\w*)\n([\s\S]*?)```", m_dia.group(1)
        ):
            entry: dict = {"content": bm.group(3).rstrip(), "type": bm.group(2) or "ascii"}
            if bm.group(1):
                entry["title"] = bm.group(1)
            diagrams.append(entry)
        if diagrams:
            narrative["diagrams"] = diagrams

    return narrative


def _parse_facts(body: str) -> list[dict]:
    section = _parse_section(body, "Facts")
    if not section:
        return []
    facts: list[dict] = []
    for line in section.split("\n"):
        s = line.strip()
        if not s.startswith("- "):
            continue
        stripped = s[2:].strip()
        # Pattern: "**subject**: statement [category]"
        structured = re.match(r"^\*\*(.+?)\*\*:\s*(.+?)(?:\s*\[(\w+)\])?$", stripped)
        if structured:
            entry = {
                "statement": structured.group(2).strip(),
                "subject": structured.group(1).strip(),
            }
            if structured.group(3):
                entry["category"] = structured.group(3)
            facts.append(entry)
            continue
        # Plain "statement [category]"
        plain = re.match(r"^(.+?)(?:\s*\[(\w+)\])?$", stripped)
        if plain:
            entry = {"statement": plain.group(1).strip()}
            if plain.group(2):
                entry["category"] = plain.group(2)
            facts.append(entry)
    return facts


# =============================================================================
# Markdown -> HTML conversion
# =============================================================================


def _to_iso(dt: datetime.datetime) -> str:
    """Render a UTC datetime as RFC3339 with millisecond precision +
    trailing Z, matching the TS html-writer's timestamp format."""
    iso = dt.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds")
    return iso.replace("+00:00", "Z")


def convert_markdown_topic_to_html(
    *, markdown: str, mtime_ms: float, rel_path: str
) -> dict:
    """One-shot conversion of a markdown topic to its bv-topic HTML
    equivalent. Returns {'html': str, 'warnings': list[str]}.

    Pure function — does not touch disk. The orchestrator is
    responsible for atomic writes.
    """
    warnings: list[str] = []
    topic_path = rel_path_to_topic_path(rel_path)

    normalized = markdown if markdown.endswith("\n") else markdown + "\n"
    frontmatter, body = _parse_frontmatter(normalized)

    title = _opt_str((frontmatter or {}).get("title")) or topic_path.split("/")[-1] or topic_path
    summary = _opt_str((frontmatter or {}).get("summary")) or ""
    tags = _str_list((frontmatter or {}).get("tags"))
    keywords = _str_list((frontmatter or {}).get("keywords"))
    related = _str_list((frontmatter or {}).get("related"))

    created_at = _opt_str((frontmatter or {}).get("createdAt"))
    updated_at = _opt_str((frontmatter or {}).get("updatedAt"))
    fallback = _to_iso(
        datetime.datetime.fromtimestamp(mtime_ms / 1000, tz=datetime.timezone.utc)
    )
    if created_at is None or updated_at is None:
        warnings.append(f"missing-timestamps: using stat.mtime fallback ({fallback})")
        created_at = created_at or fallback
        updated_at = updated_at or fallback

    raw_concept = _parse_raw_concept(body)
    narrative = _parse_narrative(body)
    facts = _parse_facts(body)
    reason = _parse_reason(body)

    snippets = _extract_snippets_from_body(body)
    if snippets:
        warnings.append(
            f"dropped-snippets: {len(snippets)} legacy '---'-separated "
            "snippets discarded (no <bv-snippet> element)"
        )

    # Assemble the topic attributes string.
    attrs: list[str] = [
        f'path="{escape_html_text(topic_path)}"',
        f'title="{escape_html_text(title)}"',
    ]
    if summary:
        attrs.append(f'summary="{escape_html_text(summary)}"')
    if tags:
        attrs.append(f'tags="{escape_html_text(",".join(tags))}"')
    if keywords:
        attrs.append(f'keywords="{escape_html_text(",".join(keywords))}"')
    if related:
        attrs.append(f'related="{escape_html_text(",".join(related))}"')
    attrs.append(f'createdat="{escape_html_text(created_at)}"')
    attrs.append(f'updatedat="{escape_html_text(updated_at)}"')

    body_parts: list[str] = []
    _append_reason(body_parts, reason)
    _append_raw_concept(body_parts, raw_concept)
    _append_narrative(body_parts, narrative)
    _append_facts(body_parts, facts)
    _append_orphans(body_parts, body)

    inner = ("\n  " + "\n  ".join(body_parts) + "\n") if body_parts else ""
    html = f"<bv-topic {' '.join(attrs)}>{inner}</bv-topic>"
    return {"html": html, "warnings": warnings}


def _append_reason(parts: list[str], reason: Optional[str]) -> None:
    if not reason:
        return
    parts.append(f"<bv-reason>{escape_html_text(reason)}</bv-reason>")


def _append_raw_concept(parts: list[str], rc: dict) -> None:
    if not rc:
        return
    if "task" in rc:
        parts.append(f"<bv-task>{escape_html_text(rc['task'])}</bv-task>")
    if rc.get("changes"):
        items = "".join(f"<li>{escape_html_text(c)}</li>" for c in rc["changes"])
        parts.append(f"<bv-changes>{items}</bv-changes>")
    if rc.get("files"):
        items = "".join(f"<li>{escape_html_text(f)}</li>" for f in rc["files"])
        parts.append(f"<bv-files>{items}</bv-files>")
    if "flow" in rc:
        parts.append(f"<bv-flow>{escape_html_text(rc['flow'])}</bv-flow>")
    if "timestamp" in rc:
        parts.append(f"<bv-timestamp>{escape_html_text(rc['timestamp'])}</bv-timestamp>")
    if "author" in rc:
        parts.append(f"<bv-author>{escape_html_text(rc['author'])}</bv-author>")
    for pat in rc.get("patterns", []):
        attrs = []
        if "flags" in pat:
            attrs.append(f' flags="{escape_html_text(pat["flags"])}"')
        if "description" in pat:
            attrs.append(f' description="{escape_html_text(pat["description"])}"')
        parts.append(
            f"<bv-pattern{''.join(attrs)}>{escape_html_text(pat['pattern'])}</bv-pattern>"
        )


def _append_narrative(parts: list[str], narr: dict) -> None:
    if not narr:
        return
    if "structure" in narr:
        parts.append(f"<bv-structure>{escape_html_text(narr['structure'])}</bv-structure>")
    if "dependencies" in narr:
        parts.append(
            f"<bv-dependencies>{escape_html_text(narr['dependencies'])}</bv-dependencies>"
        )
    if "highlights" in narr:
        parts.append(
            f"<bv-highlights>{escape_html_text(narr['highlights'])}</bv-highlights>"
        )
    if "rules" in narr:
        for rule in split_rules_block(narr["rules"]):
            sev_attr = f' severity="{rule["severity"]}"' if "severity" in rule else ""
            parts.append(
                f'<bv-rule{sev_attr} id="{escape_html_text(rule["id"])}">'
                f'{escape_html_text(rule["text"])}</bv-rule>'
            )
    if "examples" in narr:
        parts.append(f"<bv-examples>{escape_html_text(narr['examples'])}</bv-examples>")
    for d in narr.get("diagrams", []):
        type_ = normalize_diagram_type(d.get("type", ""))
        title_attr = f' title="{escape_html_text(d["title"])}"' if "title" in d else ""
        parts.append(
            f'<bv-diagram type="{type_}"{title_attr}><pre><code>'
            f'{escape_html_text(d["content"])}</code></pre></bv-diagram>'
        )


def _append_facts(parts: list[str], facts: list[dict]) -> None:
    for fact in facts:
        category = normalize_fact_category(fact.get("category"))
        attrs = []
        if "subject" in fact:
            attrs.append(f'subject="{escape_html_text(fact["subject"])}"')
        if category:
            attrs.append(f'category="{category}"')
        if "value" in fact:
            attrs.append(f'value="{escape_html_text(fact["value"])}"')
        attr_part = (" " + " ".join(attrs)) if attrs else ""
        parts.append(
            f"<bv-fact{attr_part}>{escape_html_text(fact['statement'])}</bv-fact>"
        )


def _append_orphans(parts: list[str], body: str) -> None:
    # Body already has frontmatter stripped (we operate on the
    # post-frontmatter portion in the convert function).
    for orphan in parse_orphan_sections(body):
        parts.append(
            f'<p data-md-section="{escape_html_text(orphan["heading"])}">'
            f'{escape_html_text(orphan["content"])}</p>'
        )


def _extract_snippets_from_body(body: str) -> list[str]:
    """Detect legacy `---`-separated snippets in the body. A "snippet"
    only exists when the body contains an explicit `\\n---\\n` ruler
    AFTER frontmatter has been stripped — orphan `## X` content with
    no horizontal rule isn't a snippet, it's section content (and is
    handled by parse_orphan_sections).

    Returns the list of non-empty pieces between rulers. An empty
    return means there were no snippets to drop.
    """
    if "\n---\n" not in body:
        return []
    s = body
    for heading in ("Relations", "Reason", "Raw Concept", "Narrative", "Facts"):
        pattern = re.compile(
            rf"##\s*{re.escape(heading)}[\s\S]*?(?=\n##\s|\n---\n|$)", re.IGNORECASE
        )
        s = pattern.sub("", s).strip()
    # Strip orphan `## X` sections too — those are preserved as <p>
    # blocks elsewhere and must not be re-counted as snippets here.
    s = _SECTION_REGEX.sub("", s).strip()
    snippets = [
        snippet.strip()
        for snippet in re.split(r"(?:^|\n)---\n", s)
        if snippet.strip() and snippet.strip() != "No context available."
    ]
    return snippets


# =============================================================================
# Migrator orchestrator
# =============================================================================


def _today_utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def _classify_entry(basename: str) -> str:
    """Returns 'manifest', 'derived', or 'topic'. Called for files
    NOT in _archived/ (filtered upstream)."""
    if basename == MANIFEST_FILE:
        return "manifest"
    if basename == SUMMARY_INDEX_FILE:
        return "derived"
    if basename.endswith(ABSTRACT_EXTENSION) or basename.endswith(OVERVIEW_EXTENSION):
        return "derived"
    return "topic"


def _list_tree_files(tree_root: Path) -> list[str]:
    """List every regular file relative to tree_root, skipping
    _archived/ and any hidden directory (e.g. .git/). Returns
    forward-slash-normalised relative paths sorted alphabetically.

    Hidden-dir skip: prevents the cogit `.git/` (and any other
    dot-prefixed dir) from polluting reports with hundreds of
    skipped binary entries. Hidden files at the root of the tree
    (e.g. `.snapshot.json`, `.gitignore`) still pass through and
    get classified as `unsupported-extension`.
    """
    out: list[str] = []
    if not tree_root.exists():
        return out
    for path in sorted(tree_root.rglob("*")):
        if not path.is_file():
            continue
        parts = path.relative_to(tree_root).parts
        # Skip anything inside an _archived/ or hidden subdir
        if any(p == ARCHIVE_DIR or p.startswith(".") for p in parts[:-1]):
            continue
        out.append("/".join(parts))
    return out


def _html_sibling_exists(tree_root: Path, rel_md: str) -> bool:
    if not rel_md.endswith(".md"):
        return False
    return (tree_root / rel_md[:-3]).with_suffix(".html").exists()


def _move(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))


def _write_atomic(target: Path, content: str) -> None:
    # `newline="\n"` disables Python's default CRLF translation on
    # Windows so the on-disk bytes match macOS/Linux byte-for-byte.
    # The HTML pipeline accepts CRLF, but consistent LF keeps git
    # diffs reproducible across operators on different machines.
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8", newline="\n")
    tmp.replace(target)


def _process_file(
    *,
    archive_root: Path,
    basename: str,
    tree_root: Path,
    dry_run: bool,
    rel: str,
) -> dict:
    if not basename.endswith(".md") and basename != MANIFEST_FILE:
        return {"outcome": "skipped", "reason": "unsupported-extension", "source_rel_path": rel}

    kind = _classify_entry(basename)
    source_abs = tree_root / rel
    archive_abs = archive_root / rel

    if kind in ("manifest", "derived"):
        if not dry_run:
            _move(source_abs, archive_abs)
        return {
            "outcome": "archived",
            "reason": kind,
            "source_rel_path": rel,
            "archive_path": str(archive_abs),
        }

    # kind == 'topic'
    if _html_sibling_exists(tree_root, rel):
        if not dry_run:
            _move(source_abs, archive_abs)
        return {
            "outcome": "archived",
            "reason": "html-sibling-exists",
            "source_rel_path": rel,
            "archive_path": str(archive_abs),
        }

    try:
        markdown = source_abs.read_text(encoding="utf-8")
    except OSError as e:
        # Move the file out of the live tree even when unreadable so
        # the post-migration tree stays .md-free. The reason captures
        # the read failure so it surfaces in the report.
        return _archive_failed(source_abs, archive_abs, rel, f"read-error: {e}", dry_run)

    if not markdown.strip():
        return _archive_failed(source_abs, archive_abs, rel, "empty-file", dry_run)

    mtime_ms = source_abs.stat().st_mtime * 1000.0
    try:
        result = convert_markdown_topic_to_html(
            markdown=markdown, mtime_ms=mtime_ms, rel_path=rel
        )
    except (ValueError, RuntimeError) as e:
        return _archive_failed(
            source_abs, archive_abs, rel, f"convert-error: {e}", dry_run
        )

    html_abs = (tree_root / rel[:-3]).with_suffix(".html")
    if dry_run:
        entry: dict = {
            "outcome": "migrated",
            "source_rel_path": rel,
            "html_path": str(html_abs),
        }
        if result["warnings"]:
            entry["warnings"] = result["warnings"]
        return entry

    try:
        _write_atomic(html_abs, result["html"])
        _move(source_abs, archive_abs)
    except OSError as e:
        return _archive_failed(
            source_abs, archive_abs, rel, f"write-error: {e}", dry_run
        )

    entry = {
        "outcome": "migrated",
        "source_rel_path": rel,
        "html_path": str(html_abs),
        "archive_path": str(archive_abs),
    }
    if result["warnings"]:
        entry["warnings"] = result["warnings"]
    return entry


def _archive_failed(
    source_abs: Path, archive_abs: Path, rel: str, reason: str, dry_run: bool
) -> dict:
    """Move a failed `.md` to the archive so the live tree stays
    .md-free, then report 'failed' with the reason. If the move
    itself errors, the file may remain in the live tree — the entry
    records both failures so the operator can investigate."""
    entry: dict = {"outcome": "failed", "reason": reason, "source_rel_path": rel}
    if dry_run:
        return entry
    try:
        _move(source_abs, archive_abs)
        entry["archive_path"] = str(archive_abs)
    except OSError as move_err:
        entry["reason"] = f"{reason}; archive-move-error: {move_err}"
    return entry


def run_migration(*, project_root: str, dry_run: bool = False) -> dict:
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    project_path = Path(project_root)
    tree_root = project_path / BRV_DIR / CONTEXT_TREE_DIR

    report: dict = {
        "project_root": str(project_path),
        "started_at": started_at,
        "completed_at": "",
        "dry_run": dry_run,
        "archive_root": None,
        "files": [],
        "summary": {"migrated": 0, "archived": 0, "skipped": 0, "failed": 0},
    }

    if not tree_root.exists():
        report["completed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        return report

    archive_root = (
        project_path
        / BRV_DIR
        / MIGRATIONS_DIR
        / f"{ARCHIVE_FOLDER_PREFIX}{_today_utc()}"
    )
    report["archive_root"] = str(archive_root)

    for rel in _list_tree_files(tree_root):
        basename = rel.rsplit("/", 1)[-1] if "/" in rel else rel
        entry = _process_file(
            archive_root=archive_root,
            basename=basename,
            tree_root=tree_root,
            dry_run=dry_run,
            rel=rel,
        )
        report["files"].append(entry)
        report["summary"][entry["outcome"]] += 1

    report["completed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return report


def rollback(*, project_root: str) -> dict:
    """Restore the most recent migration: move every file from the
    latest archive back into the live tree, delete matching `.html`
    siblings, then remove the archive folder."""
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    project_path = Path(project_root)
    migrations_dir = project_path / BRV_DIR / MIGRATIONS_DIR
    tree_root = project_path / BRV_DIR / CONTEXT_TREE_DIR

    archives = sorted(
        [
            p
            for p in (migrations_dir.iterdir() if migrations_dir.exists() else [])
            if p.is_dir() and p.name.startswith(ARCHIVE_FOLDER_PREFIX)
        ]
    )
    if not archives:
        raise RuntimeError(
            "No archive to roll back. Run `python migrate_context_tree.py "
            "--project-root <path>` first."
        )

    archive_root = archives[-1]
    restored = 0
    for archived_file in sorted(archive_root.rglob("*")):
        if not archived_file.is_file():
            continue
        rel = archived_file.relative_to(archive_root).as_posix()
        target = tree_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(archived_file), str(target))
        restored += 1

        if rel.endswith(".md"):
            html_sibling = (tree_root / rel[:-3]).with_suffix(".html")
            if html_sibling.exists():
                html_sibling.unlink()

    shutil.rmtree(archive_root)

    return {
        "project_root": str(project_path),
        "started_at": started_at,
        "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "archive_root": str(archive_root),
        "restored": restored,
    }


def summarize_report(report: dict) -> str:
    s = report["summary"]
    mode = "dry-run" if report["dry_run"] else "applied"
    return (
        f"[{mode}] migrated={s['migrated']} archived={s['archived']} "
        f"skipped={s['skipped']} failed={s['failed']}"
    )


# =============================================================================
# CLI
# =============================================================================


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="migrate_context_tree",
        description=(
            "Migrate a .brv/context-tree from Markdown to bv-topic HTML. "
            "Run from any project root that has .brv/."
        ),
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Project root containing .brv/. Defaults to the current directory.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Classify and convert in memory; write nothing to disk.",
    )
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="Roll back the most recent migration: restore archived "
        ".md files and remove generated .html files.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.rollback:
        result = rollback(project_root=args.project_root)
        print(
            f"Rolled back from {result['archive_root']}: "
            f"restored {result['restored']} file(s)."
        )
        return 0

    report = run_migration(project_root=args.project_root, dry_run=args.dry_run)
    print(summarize_report(report))
    if report["summary"]["failed"] > 0:
        print(
            f"\n{report['summary']['failed']} file(s) failed — sources moved "
            f"to the archive at {report['archive_root']}",
            file=sys.stderr,
        )
        for f in report["files"]:
            if f["outcome"] == "failed":
                print(f"  - {f['source_rel_path']}: {f['reason']}", file=sys.stderr)

    return 0 if report["summary"]["failed"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
