"""Comment and docstring indexer for OmriCode AI.

Scans Python files in the project directory, extracts ``#`` comments
and ``''' docstrings '''``, and builds a lightweight keyword-searchable
index using TF-IDF-like word-frequency scoring with zero external
dependencies.
"""

from __future__ import annotations

import math
import os
import re
import threading
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


# Regex to extract docstrings (single and triple quotes).
_DOCSTRING_RE = re.compile(
    r"""(?:\'{3}([\s\S]*?)\'{3}|"{3}([\s\S]*?)"{3}|#[ \t]*(.*?)$)""",
    re.MULTILINE,
)


class CommentIndex:
    """Scans Python files and builds a searchable comment/docstring index.

    Thread-safe.  Uses word-frequency-based scoring (TF-IDF analogue)
    with no external dependencies.

    Usage::

        idx = CommentIndex()
        idx.scan_project()
        results = idx.search("create mesh", max_results=5)
    """

    def __init__(self, root_path: str | None = None) -> None:
        self._root = Path(root_path or os.getcwd()).resolve()
        self._lock = threading.Lock()

        # document_id -> { "path": str, "texts": list[str] }
        self._docs: dict[int, dict[str, Any]] = {}

        # term -> { doc_id -> count }
        self._term_doc_freq: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))

        # total unique terms per doc
        self._doc_term_count: dict[int, int] = defaultdict(int)

        self._next_id: int = 0
        self._scanned: bool = False

    # ── Indexing ─────────────────────────────────────────────────

    def scan_project(self) -> int:
        """Walk the project root and index all ``.py`` files.

        Returns:
            Number of files indexed.
        """
        count = 0
        for fpath in self._root.rglob("*.py"):
            if fpath.name == "__init__.py" or fpath.is_symlink():
                continue
            try:
                self.index_file(str(fpath))
                count += 1
            except Exception:
                continue
        self._scanned = True
        return count

    def index_file(self, path: str) -> None:
        """Extract comments and docstrings from a single file.

        Args:
            path: Absolute path to a ``.py`` file.
        """
        p = Path(path).resolve()
        if not p.is_file():
            return
        text = p.read_text(encoding="utf-8", errors="replace")
        blocks = self._extract_blocks(text)
        if not blocks:
            return

        with self._lock:
            doc_id = self._next_id
            self._next_id += 1
            self._docs[doc_id] = {"path": str(p), "texts": blocks}

            for block in blocks:
                tokens = self._tokenize(block)
                term_counts = Counter(tokens)
                for term, count in term_counts.items():
                    self._term_doc_freq[term][doc_id] += count
                    self._doc_term_count[doc_id] += count

    # ── Search ───────────────────────────────────────────────────

    def search(self, query: str, max_results: int = 10) -> list[dict[str, Any]]:
        """Search the index for the given query.

        Results are ranked by a TF-IDF-like score (term frequency ×
        inverse document frequency) using only stdlib math.

        Args:
            query: Free-text search query.
            max_results: Maximum number of results to return.

        Returns:
            List of dicts with keys ``path``, ``score``, ``snippet``.
        """
        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        query_counts = Counter(query_tokens)
        num_docs = max(1, len(self._docs))

        # Compute TF-IDF for each candidate document
        scores: dict[int, float] = defaultdict(float)
        for term, qty in query_counts.items():
            doc_freq_map = self._term_doc_freq.get(term, {})
            idf = math.log(num_docs / max(1, len(doc_freq_map))) + 1.0
            for doc_id, tf_raw in doc_freq_map.items():
                total_terms = max(1, self._doc_term_count[doc_id])
                tf = tf_raw / total_terms
                scores[doc_id] += qty * tf * idf

        # Sort descending by score
        ranked = sorted(scores.items(), key=lambda x: -x[1])

        results: list[dict[str, Any]] = []
        for doc_id, score in ranked[:max_results]:
            doc = self._docs.get(doc_id, {})
            texts = doc.get("texts", [])
            snippet = texts[0][:300] if texts else ""
            results.append({
                "path": doc.get("path", ""),
                "score": round(score, 4),
                "snippet": snippet,
            })

        return results

    # ── Internal helpers ─────────────────────────────────────────

    @staticmethod
    def _extract_blocks(text: str) -> list[str]:
        """Extract all comment lines and docstrings from *text*."""
        blocks: list[str] = []
        for match in _DOCSTRING_RE.finditer(text):
            # Group 1 = triple single-quote, Group 2 = triple double-quote, Group 3 = #
            content = match.group(1) or match.group(2) or match.group(3)
            if content and content.strip():
                blocks.append(content.strip())
        return blocks

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        """Lowercase, split on non-alphanumeric, filter stop words."""
        STOP_WORDS = frozenset({
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "shall", "can",
            "to", "of", "in", "for", "on", "with", "at", "by", "from",
            "as", "into", "through", "during", "before", "after", "above",
            "below", "between", "out", "off", "over", "under", "again",
            "further", "then", "once", "here", "there", "when", "where",
            "why", "how", "all", "each", "every", "both", "few", "more",
            "most", "other", "some", "such", "no", "nor", "not", "only",
            "own", "same", "so", "than", "too", "very", "just", "because",
            "and", "but", "or", "if", "while", "that", "this", "these",
            "those", "it", "its", "he", "she", "they", "them", "their",
            "his", "her", "my", "your", "our", "itself", "himself",
            "herself", "themselves", "what", "which", "who", "whom",
        })
        tokens = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", text.lower())
        return [t for t in tokens if t not in STOP_WORDS and len(t) > 1]
