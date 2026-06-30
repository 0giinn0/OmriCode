"""Conversation message history for OmriCode AI.

Stores a list of message dicts (role/content pairs), provides helper
methods for constructing provider-compatible payloads, token estimation,
and truncation to stay within model context windows.
"""

from __future__ import annotations

from typing import Any


class MessageHistory:
    """Ordered conversation history for the agent loop.

    Each message is a dict with keys ``role`` (str) and ``content`` (str).
    """

    def __init__(self, max_tokens: int = 25000) -> None:
        self._messages: list[dict[str, str]] = []
        self._max_tokens: int = max_tokens

    # ── Properties ───────────────────────────────────────────────

    @property
    def messages(self) -> list[dict[str, str]]:
        """Return the full message list (read-only view)."""
        return list(self._messages)

    @property
    def max_tokens(self) -> int:
        """Maximum tokens before automatic truncation."""
        return self._max_tokens

    @max_tokens.setter
    def max_tokens(self, value: int) -> None:
        self._max_tokens = value

    # ── Mutation ─────────────────────────────────────────────────

    def add(self, role: str, content: str) -> None:
        """Append a message to the history.

        Args:
            role: Message role (system, user, assistant, tool).
            content: Message content text.
        """
        self._messages.append({"role": role, "content": content})

    def clear(self) -> None:
        """Remove all messages from history."""
        self._messages.clear()

    # ── Provider payloads ────────────────────────────────────────

    def get_provider_messages(
        self, system_prompt: str | None = None
    ) -> list[dict[str, str]]:
        """Build a message list suitable for sending to an LLM provider.

        If *system_prompt* is provided it is prepended as the first
        message with role ``system`` (OpenAI-style).  For providers that
        do not support a system role the caller can handle it separately.

        Args:
            system_prompt: Optional system prompt to prepend.

        Returns:
            List of message dicts.
        """
        result: list[dict[str, str]] = []
        if system_prompt:
            result.append({"role": "system", "content": system_prompt})
        result.extend(self._messages)
        return result

    # ── Token estimation & truncation ────────────────────────────

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Rough token estimation using character count * 0.35.

        Args:
            text: Input string.

        Returns:
            Estimated token count (ceiling to int).
        """
        return max(1, int(len(text) * 0.35 + 0.5))

    def truncate_if_needed(self, max_tokens: int | None = None) -> None:
        """Drop oldest messages (keeping the newest) to stay under token limit.

        The system message (if present at index 0) is always preserved.
        Estimation uses :meth:`estimate_tokens`.

        Args:
            max_tokens: Token budget; defaults to ``self.max_tokens``.
        """
        budget = max_tokens or self._max_tokens
        if not self._messages:
            return

        # Compute total tokens
        total = sum(self.estimate_tokens(m["content"]) for m in self._messages)
        if total <= budget:
            return

        # Always keep the first message if it's a system prompt
        keep_system = self._messages[0]["role"] == "system"
        start = 1 if keep_system else 0

        # Drop from the front until we fit
        while start < len(self._messages) and total > budget:
            total -= self.estimate_tokens(self._messages[start]["content"])
            start += 1

        new = []
        if keep_system:
            new.append(self._messages[0])
        new.extend(self._messages[start:])
        self._messages = new
