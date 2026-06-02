"""v2 API routes — task management for the bridge frontend."""

import asyncio
import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory session store
_sessions: dict[str, dict[str, Any]] = {}


@router.post("/v2/tasks")
async def create_task(body: dict[str, Any]):
    task_id = str(uuid.uuid4())
    agent_session_id = str(uuid.uuid4())
    cwd = body.get("cwd", ".")
    _sessions[task_id] = {
        "taskId": task_id,
        "agentSessionId": agent_session_id,
        "cwd": cwd,
        "title": body.get("title", "New Task"),
        "status": "idle",
        "messages": [],
        "createdAt": asyncio.get_event_loop().time(),
    }
    logger.info("Created task %s for cwd %s", task_id, cwd)
    return {
        "taskId": task_id,
        "agentSessionId": agent_session_id,
        "cwd": cwd,
        "modes": [{"id": "default", "name": "Default"}],
        "models": [{"id": "auto", "name": "Auto"}],
        "currentModeId": "default",
    }


@router.get("/v2/tasks")
async def list_tasks():
    tasks = []
    for tid, s in _sessions.items():
        tasks.append(
            {
                "taskId": tid,
                "agentSessionId": s.get("agentSessionId", ""),
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
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/run")
async def start_run(task_id: str, body: dict[str, Any]):
    s = _sessions.get(task_id)
    if not s:
        raise HTTPException(404, "Task not found")
    run_id = str(uuid.uuid4())
    s["status"] = "working"
    s["currentRunId"] = run_id
    s.setdefault("runs", {})[run_id] = {"messages": [], "events": []}
    logger.info("Started run %s for task %s", run_id, task_id)
    return {"runId": run_id}


@router.post("/v2/tasks/{task_id}/cancel")
@router.post("/v2/tasks/{task_id}/stop")
async def stop_run(task_id: str):
    s = _sessions.get(task_id)
    if s:
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
    from fastapi.responses import StreamingResponse
    import json
    import time

    async def event_gen():
        yield f"event: RUN_STARTED\ndata: {json.dumps({'type': 'RUN_STARTED', 'runId': runId, 'taskId': task_id, 'timestamp': time.time()})}\n\n"
        # Keep connection open briefly
        await asyncio.sleep(30)
        yield f"event: RUN_FINISHED\ndata: {json.dumps({'type': 'RUN_FINISHED', 'runId': runId, 'taskId': task_id, 'timestamp': time.time()})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/v2/tasks/{task_id}/mode")
async def set_mode(task_id: str, body: dict[str, Any]):
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/model")
async def set_model(task_id: str, body: dict[str, Any]):
    return {"status": "ok"}


@router.post("/v2/tasks/{task_id}/command")
async def execute_command(task_id: str, body: dict[str, Any]):
    return {"status": "ok", "output": ""}
