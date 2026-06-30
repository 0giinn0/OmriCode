"""ReAct agent loop for OmriCode AI.

Implements a Thought → Action → Observation cycle that reads the
current scene context, calls the LLM provider, parses tool calls,
executes them, and feeds observations back to the model until a final
response is produced.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any

from .agent_state import AgentState, AgentStates
from .message_history import MessageHistory
from ..api.http_client import OmriCodeHTTPClient
from ..api.provider_config import OmriCodeProviderConfig
from ..context.blender_context import BlenderContextBuilder
from ..tools.tool_executor import ToolExecutor
from ..tools.search_replace import SearchReplaceParser


class OmriCodeAgentLoop:
    """ReAct agent loop that processes a user message through LLM interaction.

    Manages state transitions, tool calling, and response generation in
    a background thread, writing results back to the given Blender
    PropertyGroup (``state``).

    Attributes:
        state: Reference to ``OmriCodeGlobalState`` property group.
        cfg: Reference to ``OmriCodeProviderConfig`` property group.
        agent_state: Internal state machine instance.
        history: Message history for the conversation.
    """

    # Class-level registry of running loops for cancellation
    _instances: dict[str, "OmriCodeAgentLoop"] = {}
    _instances_lock = threading.Lock()

    def __init__(
        self,
        state: Any,
        cfg: OmriCodeProviderConfig,
    ) -> None:
        self.blender_state = state
        self.cfg = cfg
        self.agent_state = AgentState(max_iterations=25)
        self.history = MessageHistory(max_tokens=25000)
        self._session_id: str = uuid.uuid4().hex[:12]
        self._client = OmriCodeHTTPClient()
        self._thread: threading.Thread | None = None

        with self._instances_lock:
            self._instances[self._session_id] = self

    # ── Public API ───────────────────────────────────────────────

    def process_message(self, text: str) -> str:
        """Start processing a user message in a background thread.

        Args:
            text: The user's input text.

        Returns:
            Session message ID (hex string).
        """
        self.history.add("user", text)
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
        )
        self._thread.start()
        return self._session_id

    def cancel(self) -> None:
        """Cancel the current agent execution."""
        self._client.cancel()
        self.agent_state.reset()

    @classmethod
    def cancel_all(cls) -> None:
        """Cancel all running agent loops."""
        with cls._instances_lock:
            for inst in cls._instances.values():
                inst.cancel()
            cls._instances.clear()

    # ── Internal loop ────────────────────────────────────────────

    def _run_loop(self) -> None:
        """Main ReAct loop executed on a background thread."""
        try:
            self.agent_state.reset()
            self.agent_state.transition(AgentStates.thinking)
            self._update_status("Thinking...")

            # Build system prompt from current context
            ctx = BlenderContextBuilder()
            system_prompt = ctx.build_system_prompt()

            for iteration in range(self.agent_state.max_iterations):
                if self.agent_state.is_iteration_limit_reached():
                    break

                self.agent_state.iteration = iteration
                self.blender_state.iteration_count = iteration

                # ── 1. Think → Decide → Execute cycle ─────────
                provider_msgs = self.history.get_provider_messages(system_prompt)
                provider_cfg = self.cfg.to_dict()
                tools = ToolExecutor.list_tool_definitions()

                self.agent_state.transition(AgentStates.deciding)
                self._update_status("Deciding...")

                llm_output = self._query_llm(provider_msgs, tools, provider_cfg)

                if not llm_output:
                    self._append_chat("Assistant: (no response)")
                    break

                # ── 2. Check for tool calls ─────────────────────
                tool_calls = self._parse_tool_calls(llm_output)

                if not tool_calls:
                    # No tools → treat as final response
                    self.agent_state.transition(AgentStates.respond)
                    self._append_chat(f"Assistant: {llm_output}")
                    self._update_status("Ready")
                    return

                # ── 3. Execute each tool ───────────────────────
                self.agent_state.transition(AgentStates.executing)
                self._update_status("Executing tools...")

                observations = []
                for call in tool_calls:
                    name = call.get("name", "")
                    args = call.get("arguments", {})
                    self._append_chat(f"  🔧 {name}({json.dumps(args)[:200]})")
                    result = ToolExecutor.execute(name, args)
                    obs = json.dumps(result, ensure_ascii=False)[:2000]
                    observations.append({"role": "tool", "content": obs})
                    self.history.add("assistant", f"*called {name}*")

                # ── 4. Feed observations back ──────────────────
                self.agent_state.transition(AgentStates.observing)
                self._update_status("Observing results...")

                for obs_msg in observations:
                    self.history.add(obs_msg["role"], obs_msg["content"])

                # Trim history if needed
                self.history.truncate_if_needed()

                self.agent_state.transition(AgentStates.thinking)
                self._update_status("Thinking...")

            # ── Iteration limit reached ──────────────────────────
            self.agent_state.transition(AgentStates.respond)
            self._append_chat(
                "Assistant: I've reached the maximum number of steps. "
                "Please refine your request or ask me to continue."
            )
            self._update_status("Stopped (limit)")

        except Exception as exc:
            self._append_chat(f"System: Error — {exc}")
            self._update_status("Error")
        finally:
            self.blender_state.session_active = False
            with self._instances_lock:
                self._instances.pop(self._session_id, None)

    # ── LLM query ────────────────────────────────────────────────

    def _query_llm(
        self,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]],
        provider_cfg: dict[str, Any],
    ) -> str:
        """Send messages to the LLM and return the text response."""
        collected: list[str] = []

        def _on_chunk(chunk: str) -> None:
            collected.append(chunk)

        try:
            self._client.send_message(
                messages=messages,
                tools=tools,
                provider_config=provider_cfg,
                callback=_on_chunk,
            )
        except RuntimeError as exc:
            return f"Error querying LLM: {exc}"

        return "".join(collected)

    # ── Tool call parsing ────────────────────────────────────────

    @staticmethod
    def _parse_tool_calls(text: str) -> list[dict[str, Any]]:
        """Extract tool calls from LLM output.

        Supports both JSON-in-markdown (`````json ... `````) and
        bare JSON arrays/objects with ``"name"`` and ``"arguments"``
        keys, as well as SEARCH/REPLACE blocks.
        """
        calls: list[dict[str, Any]] = []

        # 1. Check for SEARCH/REPLACE blocks first
        sr_blocks = SearchReplaceParser.parse(text)
        if sr_blocks:
            # Represent each SEARCH/REPLACE as an edit_file tool call
            for block in sr_blocks:
                calls.append({
                    "name": "edit_file",
                    "arguments": {
                        "search": block["search"],
                        "replace": block["replace"],
                    },
                })
            return calls

        # 2. Try to extract JSON from markdown code fences
        import re

        json_blocks = re.findall(
            r"```(?:json)?\s*\n([\s\S]*?)```", text, re.MULTILINE
        )
        for block in json_blocks:
            block = block.strip()
            if not block:
                continue
            try:
                parsed = json.loads(block)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, list):
                calls.extend(parsed)
            elif isinstance(parsed, dict):
                calls.append(parsed)

        # 3. Fallback: look for function_call / tool_calls in the
        #    raw text if nothing was found yet
        if not calls:
            try:
                data = json.loads(text)
                if isinstance(data, list):
                    calls.extend(data)
                elif isinstance(data, dict):
                    calls.append(data)
            except json.JSONDecodeError:
                pass

        return calls

    # ── Blender state helpers ────────────────────────────────────

    def _update_status(self, text: str) -> None:
        """Update the status label on the Blender UI state."""
        self.blender_state.status_text = text

    def _append_chat(self, text: str) -> None:
        """Append a line to the chat log."""
        current = self.blender_state.chat_log or ""
        MAX_LOG = 32000
        if len(current) + len(text) + 1 > MAX_LOG:
            lines = current.split("\n")
            lines = lines[len(lines) // 4:]
            current = "\n".join(lines)
        self.blender_state.chat_log = (
            current + "\n" + text if current else text
        )
