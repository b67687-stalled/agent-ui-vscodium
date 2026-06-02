"""v2 API routes — task management with real ACP agent streaming."""

import asyncio
import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.agui.events import (
    AguiEventType,
    BaseAguiEvent,
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
)
from backend.agui.sse import event_stream
from backend.agent.runner import get_runner

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory store: task_id → task state
_sessions: dict[str, dict[str, Any]] = {}

# Per-task event queues: task_id → asyncio.Queue
_event_queues: dict[str, asyncio.Queue] = {}


@router.post("/v2/tasks")
async def create_task(body: dict[str, Any]):
    task_id = str(uuid.uuid4())
    cwd = body.get("cwd", ".")
    _sessions[task_id] = {
        "taskId": task_id,
        "cwd": cwd,
        "title": body.get("title", "New Task"),
        "status": "idle",
        "messages": [],
        "acpSessionId": None,  # filled on first run
        "currentRunId": None,
        "createdAt": asyncio.get_event_loop().time(),
    }
    logger.info("Created task %s for cwd %s", task_id, cwd)
    return {
        "taskId": task_id,
        "cwd": cwd,
        "modes": [
            {"id": "code", "name": "Code"},
            {"id": "architect", "name": "Architect"},
        ],
        "models": [{"id": "auto", "name": "Auto"}],
        "currentModeId": "code",
    }


@router.get("/v2/tasks")
async def list_tasks():
    tasks = []
    for tid, s in _sessions.items():
        tasks.append(
            {
                "taskId": tid,
                "cwd": s.get("cwd", ""),
                "title": s.get("title", "New Task"),
                "status": s.get("status", "idle"),
            }
        )
    return {"tasks": tasks}


@router.get("/v2/tasks/resumable")
async def list_resumable():
    return {"tasks": []}


@router.get("/v2/tasks/{task_id}")
async def get_task(task_id: str):
    s = _sessions.get(task_id)
    if not s:
        raise HTTPException(404, "Task not found")
    return s


@router.post("/v2/tasks/{task_id}")
async def update_task(task_id: str, body: dict[str, Any]):
    s = _sessions.get(task_id)
    if not s:
        raise HTTPException(404, "Task not found")
    s.update(body)
    return {"status": "ok"}


@router.delete("/v2/tasks/{task_id}")
async def delete_task(task_id: str):
    _sessions.pop(task_id, None)
    _event_queues.pop(task_id, None)
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/run")
async def start_run(task_id: str, body: dict[str, Any]):
    """Start a run: create ACP session if needed, queue user message."""
    s = _sessions.get(task_id)
    if not s:
        raise HTTPException(404, "Task not found")

    run_id = str(uuid.uuid4())
    s["status"] = "working"
    s["currentRunId"] = run_id

    # Create or reuse an event queue
    if task_id not in _event_queues:
        _event_queues[task_id] = asyncio.Queue()

    agui_queue = _event_queues[task_id]

    # Put RUN_STARTED event
    await agui_queue.put(RunStartedEvent(runId=run_id, taskId=task_id))

    # Extract user messages from body
    messages = body.get("messages", [])
    user_text = ""
    for msg in messages:
        if msg.get("role") == "user" and msg.get("content"):
            parts = msg["content"]
            if isinstance(parts, str):
                user_text = parts
            elif isinstance(parts, list):
                for p in parts:
                    if isinstance(p, dict) and p.get("type") == "text":
                        user_text = p.get("text", "")
                        break

    if not user_text:
        # fallback: use first text content
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                user_text = content
                break

    if user_text:
        # Save to session history
        s.setdefault("messages", []).append({"role": "user", "content": user_text})

    # Launch background agent task
    asyncio.create_task(_run_agent(task_id, s, user_text, agui_queue))

    logger.info("Started run %s for task %s", run_id, task_id)
    return {"runId": run_id}


async def _run_agent(
    task_id: str, session: dict, user_text: str, agui_queue: asyncio.Queue
):
    """Background task: initialize ACP, create session, run prompt."""
    try:
        runner = get_runner()

        # Create or reuse ACP session
        acp_session_id = session.get("acpSessionId")
        if not acp_session_id:
            cwd = session.get("cwd", ".")
            result = await runner.create_session(cwd, agui_queue)
            acp_session_id = result["sessionId"]
            session["acpSessionId"] = acp_session_id
            logger.info("Created ACP session %s for task %s", acp_session_id, task_id)

        # Run the prompt — the runner emits TEXT_MESSAGE_* + RUN_FINISHED
        if user_text:
            await runner.prompt(acp_session_id, user_text, agui_queue)
        else:
            # No user text — just signal done
            session["status"] = "idle"
            run_id = session.get("currentRunId", "")
            await agui_queue.put(RunFinishedEvent(runId=run_id, taskId=task_id))

    except asyncio.CancelledError:
        logger.info("Agent run cancelled for task %s", task_id)
        session["status"] = "idle"
    except Exception as exc:
        logger.exception("Agent run failed for task %s", task_id)
        session["status"] = "error"
        try:
            run_id = session.get("currentRunId", "")
            await agui_queue.put(
                RunErrorEvent(runId=run_id, taskId=task_id, message=str(exc))
            )
        except Exception:
            pass


@router.post("/v2/tasks/{task_id}/cancel")
@router.post("/v2/tasks/{task_id}/stop")
async def stop_run(task_id: str):
    s = _sessions.get(task_id)
    if s:
        acp_session_id = s.get("acpSessionId")
        if acp_session_id:
            runner = get_runner()
            await runner.cancel_prompt(acp_session_id)
        s["status"] = "idle"
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/approval")
async def send_approval(task_id: str, body: dict[str, Any]):
    return {"status": "ok"}


@router.get("/v2/tasks/{task_id}/messages")
async def get_messages(task_id: str):
    s = _sessions.get(task_id)
    if not s:
        raise HTTPException(404, "Task not found")
    return {"messages": s.get("messages", [])}


@router.get("/v2/tasks/{task_id}/events")
async def get_events(task_id: str, runId: str = ""):
    """SSE endpoint: streams AG-UI events from the agent."""
    s = _sessions.get(task_id)
    if not s:
        raise HTTPException(404, "Task not found")

    agui_queue = _event_queues.get(task_id)
    if not agui_queue:
        # No active run — return a 200 with no events (frontend handles this)
        async def empty():
            yield ": no active run\n\n"

        return StreamingResponse(empty(), media_type="text/event-stream")

    logger.info("SSE client connected for task %s run %s", task_id, runId)
    return StreamingResponse(
        event_stream(agui_queue, task_id, timeout=120),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/v2/tasks/{task_id}/mode")
async def set_mode(task_id: str, body: dict[str, Any]):
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/model")
async def set_model(task_id: str, body: dict[str, Any]):
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/command")
async def execute_command(task_id: str, body: dict[str, Any]):
    return {"status": "ok", "output": ""}
