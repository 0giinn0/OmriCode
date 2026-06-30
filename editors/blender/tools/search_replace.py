"""SEARCH/REPLACE block parser for OmriCode AI.

Extracts ``<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE`` blocks
from LLM-generated text and converts them into structured edit
directives for the file-editing tools.
"""

from __future__ import annotations

import re
from typing import Any


# Matches the standard SEARCH/REPLACE block format used by many
# code-editing LLMs.
_SEARCH_REPLACE_RE = re.compile(
    r"<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE",
    re.MULTILINE,
)


class SearchReplaceParser:
    """Parser for SEARCH/REPLACE diff blocks.

    Usage::

        blocks = SearchReplaceParser.parse(text)
        for block in blocks:
            print(block["search"], "→", block["replace"])
    """

    @staticmethod
    def parse(text: str) -> list[dict[str, str]]:
        """Extract all SEARCH/REPLACE blocks from *text*.

        Args:
            text: Raw LLM output potentially containing one or more
                SEARCH/REPLACE blocks.

        Returns:
            A list of dicts, each with keys ``search`` and ``replace``.
            Returns an empty list if no blocks are found.
        """
        blocks: list[dict[str, str]] = []
        for match in _SEARCH_REPLACE_RE.finditer(text):
            search_content = match.group(1)
            replace_content = match.group(2)
            # Normalise trailing newlines for consistent matching
            search_content = _normalise_trailing_newlines(search_content)
            replace_content = _normalise_trailing_newlines(replace_content)
            blocks.append({
                "search": search_content,
                "replace": replace_content,
            })
        return blocks

    @staticmethod
    def has_blocks(text: str) -> bool:
        """Quick check whether *text* contains any SEARCH/REPLACE blocks.

        Args:
            text: Raw text to scan.

        Returns:
            True if at least one block is present.
        """
        return bool(_SEARCH_REPLACE_RE.search(text))


def _normalise_trailing_newlines(content: str) -> str:
    """Ensure content ends with exactly one newline for consistent matching."""
    return content.rstrip("\n") + "\n"
