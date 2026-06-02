"""
ACP Agent Runner — spawns omp acp, manages sessions, streams events.

Protocol: Agent Client Protocol (ACP) over JSON-RPC 2.0 / stdio.
  - `initialize`            → get capabilities
  - `session/new`           → create session (maps to our task)
  - `session/prompt`        → send user message, stream response
  - `session/cancel`        → interrupt current prompt
  - `session/close`         → tear down session

Works with any ACP-compatible agent (omp acp, kiro-cli acp, codex, etc.)
"""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any

from backend.agui.events import (
    AguiEventType,
    BaseAguiEvent,
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    StateUpdateEvent,
    CustomEvent,
)

logger = logging.getLogger(__name__)


# ── JSON-RPC 2.0 helpers ───────────────────────────────────────────────────


class JsonRpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        self.code = code
        self.message = message
        self.data = data
        super().__init__(f"[{code}] {message}")


def _make_request(method: str, params: dict | None = None, msg_id: int = 1) -> str:
    req = {"jsonrpc": "2.0", "method": method, "id": msg_id}
    if params is not None:
        req["params"] = params
    return json.dumps(req)


def _make_notification(method: str, params: dict | None = None) -> str:
    req = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        req["params"] = params
    return json.dumps(req)


# ── ACP Event types (notifications from agent) ────────────────────────────


class AcpUpdate:
    """A single session/update notification or prompt response."""

    __slots__ = ("type", "data")

    def __init__(self, raw: dict):
        self.type: str = ""
        self.data: dict = raw

        method = raw.get("method", "")
        params = raw.get("params", {})

        if method == "session/update":
            self.type = params.get("sessionUpdate", "unknown")
        elif method == "session/prompt" and "result" in raw:
            self.type = "result"


# ── ACP Session (one per task) ─────────────────────────────────────────────


class AcpSession:
    """Manages one ACP session (conversation thread)."""

    def __init__(self, session_id: str, cwd: str):
        self.session_id = session_id
        self.cwd = cwd
        self.current_prompt_id: int = 0
        self._cancel_event = asyncio.Event()


# ── Agent Runner ────────────────────────────────────────────────────────────


class AgentRunner:
    """
    Manages the omp acp subprocess and all ACP sessions.

    The runner:
    1. Spawns `omp acp` on first use (lazy)
    2. Sends JSON-RPC requests to stdin
    3. Reads responses + notifications from stdout
    4. Maintains a read-loop that dispatches notifications to queues
    """

    def __init__(self, agent_command: list[str] | None = None):
        self._agent_command = agent_command or ["omp", "acp"]
        self._process: asyncio.subprocess.Process | None = None
        self._read_task: asyncio.Task | None = None
        self._initialized = False
        self._next_id: int = 1

        # Pending request ID → Future for response
        self._pending: dict[int, asyncio.Future] = {}

        # Session ID → asyncio.Queue for ACP session/update notifications
        self._session_queues: dict[str, asyncio.Queue] = {}

        # Session ID → asyncio.Queue for AG-UI events (frontend-bound)
        self._agui_queues: dict[str, asyncio.Queue] = {}

        # In-flight prompt responses: msg_id → session_id
        self._prompt_inflight: dict[int, str] = {}

        # Global notification handlers
        self._notification_handlers: list[callable] = []

        self._lock = asyncio.Lock()

    async def _spawn(self):
        """Spawn the omp acp subprocess."""
        logger.info("Spawning agent: %s", " ".join(self._agent_command))
        self._process = await asyncio.create_subprocess_exec(
            *self._agent_command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # Start the read loop
        self._read_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self):
        """Continuous reader: parse newline-delimited JSON from stdout.

        Uses a raw-chunk reader instead of readline() to avoid Python's
        64KB line-length limit on large ACP responses.
        """
        buf = ""
        try:
            while True:
                chunk = await self._process.stdout.read(8192)
                if not chunk:
                    logger.warning("ACP process stdout closed")
                    break
                buf += chunk.decode("utf-8")
                # Process all complete lines in the buffer
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        logger.warning("ACP non-JSON output: %s", line[:200])
                        continue
                    await self._dispatch_message(msg)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("ACP read loop error")
        finally:
            # Cancel any pending requests
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("ACP process died"))
            self._pending.clear()
            logger.info("ACP read loop ended")

    async def _dispatch_message(self, msg: dict):
        """Route a JSON-RPC message to its handler."""
        msg_id = msg.get("id")
        method = msg.get("method")
        error = msg.get("error")
        result = msg.get("result")
        params = msg.get("params", {})

        # ── Response to a session/prompt request ───────────────────────
        # Route through the session's notification queue instead of a
        # future to avoid races between notifications and the response.
        if msg_id is not None and msg_id in self._prompt_inflight:
            session_id = self._prompt_inflight.pop(msg_id)
            q = self._session_queues.get(session_id)
            if q:
                marker = {
                    "result" if result else "error": result or error,
                    "stopReason": (result or {}).get("stopReason", "end_turn"),
                }
                await q.put(("__response__", marker))
            return

        # ── Response to an ordinary request ─────────────────────────────
        if msg_id is not None and msg_id in self._pending:
            fut = self._pending.pop(msg_id)
            if error:
                fut.set_exception(
                    JsonRpcError(error["code"], error["message"], error.get("data"))
                )
            else:
                fut.set_result(result)
            return

        # ── Server notification ─────────────────────────────────────────
        if method and "id" not in msg:
            await self._handle_notification(method, params)
            return

        logger.debug("Unhandled ACP message: %s", json.dumps(msg)[:200])

    async def _handle_notification(self, method: str, params: dict):
        """Handle a server notification."""
        if method == "session/update":
            session_id = params.get("sessionId", "")
            update = params.get("update", {})
            update_type = update.get("sessionUpdate", "")
            update_data = update
            await self._route_session_update(session_id, update_type, update_data)
        elif method == "session/prompt" and "result" in params:
            # Some ACP servers send result inside the notification
            session_id = params.get("sessionId", "")
            if session_id in self._session_queues:
                await self._session_queues[session_id].put(
                    ("result", params.get("result", {}))
                )
        else:
            logger.debug("Unhandled notification %s", method)

    async def _route_session_update(
        self, session_id: str, update_type: str, data: dict
    ):
        """Route a session/update to the appropriate session queue."""
        if session_id not in self._session_queues:
            logger.debug(
                "No queue for session %s, dropping update %s", session_id, update_type
            )
            return
        await self._session_queues[session_id].put((update_type, data))

    # ── Public API ───────────────────────────────────────────────────────

    async def initialize(self) -> dict:
        """Initialize the ACP connection."""
        async with self._lock:
            if self._initialized:
                return {"status": "already_initialized"}
            if self._process is None:
                await self._spawn()

            msg_id = self._next_id
            self._next_id += 1
            fut: asyncio.Future = asyncio.get_event_loop().create_future()
            self._pending[msg_id] = fut

            req = _make_request("initialize", {"protocolVersion": 1}, msg_id)
            self._process.stdin.write((req + "\n").encode("utf-8"))
            await self._process.stdin.drain()

            result = await asyncio.wait_for(fut, timeout=10)
            self._initialized = True
            logger.info(
                "ACP initialized: agent=%s v=%s",
                result.get("agentInfo", {}).get("name"),
                result.get("agentInfo", {}).get("version"),
            )
            return result

    async def create_session(
        self, cwd: str, agui_queue: asyncio.Queue | None = None
    ) -> dict:
        """Create a new ACP session and return the session info."""
        if not self._initialized:
            await self.initialize()

        # omp acp requires an absolute path
        abs_cwd = os.path.abspath(cwd)

        msg_id = self._next_id
        self._next_id += 1
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut

        req = _make_request("session/new", {"cwd": abs_cwd, "mcpServers": []}, msg_id)
        self._process.stdin.write((req + "\n").encode("utf-8"))
        await self._process.stdin.drain()

        result = await asyncio.wait_for(fut, timeout=30)

        session_id = result.get("sessionId", str(uuid.uuid4()))
        # Separate queues: acp_queue for notifications, agui_queue for frontend events
        self._session_queues[session_id] = asyncio.Queue()
        if agui_queue:
            self._agui_queues[session_id] = agui_queue

        logger.info("ACP session created: %s for cwd %s", session_id, cwd)
        return {
            "sessionId": session_id,
            "availableModes": result.get(
                "availableModes", [{"id": "code", "name": "Code"}]
            ),
            "currentMode": result.get("currentMode", "code"),
        }

    async def prompt(
        self,
        session_id: str,
        message: str,
        agui_queue: asyncio.Queue,
    ) -> None:
        """
        Send a user message to the ACP session and stream events into agui_queue.

        This method:
        1. Sends session/prompt request
        2. Reads session/update notifications from the session queue
        3. Converts ACP updates to AG-UI events
        4. Puts AG-UI events into the AG-UI queue
        """
        from backend.agui.events import RunStartedEvent, RunFinishedEvent

        # Ensure the ACP notification queue exists
        acp_queue = self._session_queues.get(session_id)
        if acp_queue is None:
            acp_queue = asyncio.Queue()
            self._session_queues[session_id] = acp_queue
        # Store the AG-UI output queue
        if agui_queue:
            self._agui_queues[session_id] = agui_queue

        msg_id = self._next_id
        self._next_id += 1

        # Register prompt response routing (NOT in _pending — goes to queue)
        self._prompt_inflight[msg_id] = session_id

        # Prepare the prompt (array of content blocks, NOT {role,content} objects)
        prompt_msg = {
            "sessionId": session_id,
            "prompt": [
                {"type": "text", "text": message},
            ],
        }

        req = _make_request("session/prompt", prompt_msg, msg_id)
        self._process.stdin.write((req + "\n").encode("utf-8"))
        await self._process.stdin.drain()

        # Read notifications from the ACP notification queue
        notif_queue = self._session_queues.get(session_id, acp_queue)
        message_id = str(uuid.uuid4())
        has_content = False
        last_msg_ended = True
        current_tool_call_id = None
        stop_reason = "end_turn"

        try:
            while True:
                # Poll for next notification or response marker
                try:
                    update_type, data = await asyncio.wait_for(
                        notif_queue.get(), timeout=120
                    )
                except asyncio.TimeoutError:
                    await agui_queue.put(
                        RunErrorEvent(
                            runId="",
                            taskId=session_id,
                            message="Agent response timed out",
                        )
                    )
                    break

                # ── Prompt response received ──────────────────────────
                if update_type == "__response__":
                    is_error = "error" in data
                    if is_error:
                        err = data.get("error", {})
                        err_msg = (
                            err.get("message", "ACP error")
                            if isinstance(err, dict)
                            else str(err)
                        )
                        logger.warning("ACP prompt error: %s", err_msg)
                        await agui_queue.put(
                            RunErrorEvent(runId="", taskId=session_id, message=err_msg)
                        )
                    else:
                        stop_reason = data.get("stopReason", "end_turn")
                        # Flush any pending message end
                        if has_content and not last_msg_ended:
                            await agui_queue.put(
                                TextMessageEndEvent(messageId=message_id)
                            )
                        await agui_queue.put(
                            RunFinishedEvent(runId="", taskId=session_id)
                        )
                    break

                # Extract text from content blocks
                def get_text(d):
                    c = d.get("content", "")
                    if isinstance(c, dict):
                        return c.get("text", "")
                    if isinstance(c, str):
                        return c
                    return ""

                # ── Agent thought/message streaming ────────────────
                if update_type in (
                    "agent_thought_chunk",
                    "agent_message_chunk",
                    "assistant_message_chunk",
                ):
                    chunk_text = get_text(data)
                    if chunk_text:
                        if not has_content:
                            await agui_queue.put(
                                TextMessageStartEvent(messageId=message_id)
                            )
                            has_content = True
                            last_msg_ended = False
                        await agui_queue.put(
                            TextMessageContentEvent(
                                messageId=message_id, delta=chunk_text
                            )
                        )

                elif update_type in ("agent_message", "assistant_message"):
                    full_text = get_text(data)
                    if full_text:
                        if not has_content:
                            await agui_queue.put(
                                TextMessageStartEvent(messageId=message_id)
                            )
                            has_content = True
                        await agui_queue.put(
                            TextMessageContentEvent(
                                messageId=message_id, delta=full_text
                            )
                        )
                        await agui_queue.put(TextMessageEndEvent(messageId=message_id))
                        last_msg_ended = True

                # ── Tool calls ─────────────────────────────────────
                elif update_type == "tool_call_start":
                    tool_name = data.get("toolName", "unknown")
                    tool_call_id = data.get("toolCallId", str(uuid.uuid4()))
                    current_tool_call_id = tool_call_id
                    await agui_queue.put(
                        ToolCallStartEvent(
                            toolCallId=tool_call_id, toolCallName=tool_name
                        )
                    )

                elif update_type == "tool_call_args":
                    if current_tool_call_id:
                        args_chunk = data.get("argsDelta", "") or data.get("delta", "")
                        if args_chunk:
                            await agui_queue.put(
                                ToolCallArgsEvent(
                                    toolCallId=current_tool_call_id,
                                    delta=args_chunk,
                                )
                            )

                elif update_type == "tool_call_result":
                    tid = data.get("toolCallId", current_tool_call_id or "")
                    result_text = data.get("result", "") or get_text(data)
                    await agui_queue.put(
                        ToolCallEndEvent(toolCallId=tid, result=result_text)
                    )

                # ── Approvals ───────────────────────────────────────
                elif update_type == "user_action_needed":
                    await agui_queue.put(
                        StateUpdateEvent(
                            state={
                                "approval": {
                                    "pending": True,
                                    "callId": data.get("callId", ""),
                                    "toolName": data.get("toolName", ""),
                                    "summary": data.get("summary", ""),
                                    "options": data.get("options", []),
                                }
                            }
                        )
                    )

                # ── End / error markers ────────────────────────────
                elif update_type == "error" or update_type == "agent_error":
                    err_msg = data.get("message", "Agent error")
                    await agui_queue.put(
                        RunErrorEvent(runId="", taskId=session_id, message=err_msg)
                    )
                    break

                else:
                    # Skip unhandled types silently
                    pass

        except asyncio.TimeoutError:
            logger.warning("ACP prompt timed out for session %s", session_id)
            await agui_queue.put(
                RunErrorEvent(
                    runId="",
                    taskId=session_id,
                    message="Agent response timed out",
                )
            )
        except Exception as prompt_exc:
            logger.exception("ACP prompt error for session %s", session_id)
            import traceback

            print(f"ACP PROMPT ERROR: {prompt_exc}", flush=True)
            traceback.print_exc()
            await agui_queue.put(
                RunErrorEvent(
                    runId="",
                    taskId=session_id,
                    message="Internal bridge error",
                )
            )
        finally:
            # Clean up
            self._session_queues.pop(session_id, None)
            # Clean up any leftover prompt inflight entry
            for mid, sid in list(self._prompt_inflight.items()):
                if sid == session_id:
                    self._prompt_inflight.pop(mid, None)

    async def cancel_prompt(self, session_id: str):
        """Cancel the current prompt for a session."""
        msg_id = self._next_id
        self._next_id += 1
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut

        req = _make_request("session/cancel", {"sessionId": session_id}, msg_id)
        self._process.stdin.write((req + "\n").encode("utf-8"))
        await self._process.stdin.drain()

        try:
            await asyncio.wait_for(fut, timeout=5)
        except (asyncio.TimeoutError, JsonRpcError):
            pass

    async def close_session(self, session_id: str):
        """Close an ACP session."""
        try:
            msg_id = self._next_id
            self._next_id += 1
            req = _make_request("session/close", {"sessionId": session_id}, msg_id)
            self._process.stdin.write((req + "\n").encode("utf-8"))
            await self._process.stdin.drain()
        except Exception:
            logger.exception("Error closing session %s", session_id)
        finally:
            self._session_queues.pop(session_id, None)

    async def shutdown(self):
        """Shut down the ACP process."""
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
        if self._process:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                try:
                    self._process.kill()
                    await self._process.wait()
                except ProcessLookupError:
                    pass
        self._initialized = False
        self._process = None
        self._read_task = None


# ── Global singleton ────────────────────────────────────────────────────────

_runner: AgentRunner | None = None


def get_runner() -> AgentRunner:
    global _runner
    if _runner is None:
        _runner = AgentRunner()
    return _runner


async def shutdown_runner():
    global _runner
    if _runner:
        await _runner.shutdown()
        _runner = None
