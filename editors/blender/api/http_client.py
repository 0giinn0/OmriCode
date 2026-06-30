"""Threaded HTTP client for OmriCode AI.

Sends chat completion requests to OpenAI-, Anthropic-, or Ollama-compatible
endpoints using only stdlib ``urllib``.  Supports SSE streaming with
per-chunk callbacks and a configurable timeout.
"""

from __future__ import annotations

import json
import threading
import urllib.request
import urllib.error
from typing import Any, Callable


class OmriCodeHTTPClient:
    """A lightweight, threaded HTTP client for LLM provider APIs.

    Usage::

        client = OmriCodeHTTPClient()
        client.send_message(
            messages=[{"role": "user", "content": "Hello"}],
            tools=[],
            provider_config={"endpoint": "...", "model": "...", ...},
            callback=lambda chunk: print(chunk, end=""),
        )
    """

    _TIMEOUT_DEFAULT = 60

    def __init__(self) -> None:
        self._cancel_event = threading.Event()

    # ── Public API ───────────────────────────────────────────────

    def send_message(
        self,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]],
        provider_config: dict[str, Any],
        callback: Callable[[str], None] | None = None,
    ) -> str:
        """Send a chat completion request and return the full response text.

        Args:
            messages: List of message dicts with ``role`` and ``content`` keys.
            tools: List of tool definitions (may be empty).
            provider_config: Dict with keys ``endpoint``, ``model``,
                ``api_key``, ``max_tokens``, ``temperature``, ``timeout``.
            callback: Optional callable receiving each text chunk as it
                arrives (for streaming UI updates).

        Returns:
            The full response content string.

        Raises:
            RuntimeError: On HTTP or parse errors.
        """
        self._cancel_event.clear()

        endpoint = provider_config.get("endpoint", "").rstrip("/")
        model = provider_config.get("model", "nous-hermes-gguf")
        api_key = provider_config.get("api_key", "")
        max_tokens = provider_config.get("max_tokens", 4096)
        temperature = provider_config.get("temperature", 0.7)
        timeout = provider_config.get("timeout", self._TIMEOUT_DEFAULT)

        url = endpoint + "/chat/completions"

        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        if tools:
            body["tools"] = tools

        raw_body = json.dumps(body).encode()

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        req = urllib.request.Request(
            url, data=raw_body, headers=headers, method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                content_type = resp.headers.get("Content-Type", "")
                if "text/event-stream" in content_type or "application/x-ndjson" in content_type:
                    return self._read_sse(resp, callback)
                return self._read_json(resp, callback)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise RuntimeError(
                f"HTTP {exc.code} from {url}: {exc.reason}\n{detail[:500]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Connection failed: {exc.reason}") from exc

    def cancel(self) -> None:
        """Signal the current request to stop (best-effort)."""
        self._cancel_event.set()

    # ── Streaming helpers ────────────────────────────────────────

    def _read_sse(
        self,
        resp: urllib.request.addinfourl,
        callback: Callable[[str], None] | None,
    ) -> str:
        """Read an SSE stream, calling *callback* for each text delta."""
        full_text: list[str] = []
        buffer = ""

        while not self._cancel_event.is_set():
            chunk = resp.read(4096)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", errors="replace")

            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    delta = self._extract_delta(data)
                    if delta:
                        full_text.append(delta)
                        if callback:
                            callback(delta)

        return "".join(full_text)

    def _read_json(
        self,
        resp: urllib.request.addinfourl,
        callback: Callable[[str], None] | None,
    ) -> str:
        """Read a non-streaming JSON response."""
        raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
        text = self._extract_delta(data)
        if callback and text:
            callback(text)
        return text

    @staticmethod
    def _extract_delta(data: dict[str, Any]) -> str:
        """Extract text content from various provider response formats."""
        # OpenAI / Ollama streaming delta
        choices = data.get("choices", [])
        if choices:
            delta = choices[0].get("delta", {})
            content = delta.get("content", "")
            if content:
                return content
            message = choices[0].get("message", {})
            return message.get("content", "")

        # Anthropic-like
        content = data.get("content", [])
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
            return "".join(parts)
        if isinstance(content, str):
            return content

        return ""
