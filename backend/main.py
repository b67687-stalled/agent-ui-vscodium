"""FastAPI main application for the ACP → AG-UI Bridge."""

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

# Windows: force the Proactor event loop. uvicorn's --reload supervisor sets
# WindowsSelectorEventLoopPolicy, which doesn't implement subprocess_exec and
# breaks spawning ACP agents (NotImplementedError from _make_subprocess_transport).
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import __version__
from backend.config import load_config
from backend.schemas.api import HealthResponse

from backend.logging_config import setup_logging
from backend.agent.runner import shutdown_runner

setup_logging()
logger = logging.getLogger(__name__)

config = load_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager for startup/shutdown."""
    setup_logging()  # Re-apply after uvicorn's setup
    logger.info(f"ACP → AG-UI Bridge v{__version__} (FastAPI)")
    logger.info(f"Backend: http://localhost:{config.backend_port}")
    logger.info("Endpoints:")
    skip = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            if route.path in skip:
                continue
            methods = ", ".join(sorted(route.methods - {"HEAD", "OPTIONS"}))
            if methods:
                logger.info(f"  {methods:6s} {route.path}")
    logger.info("---")

    app.state.config = config
    app.state.sessions: dict[str, dict] = {}

    yield

    logger.info("Shutting down ACP → AG-UI Bridge")
    await shutdown_runner()


app = FastAPI(
    title=config.display_title,
    description=config.description,
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check() -> HealthResponse:
    """Health check endpoint."""
    return HealthResponse(status="ok", version=__version__, project=config.project_name)


from backend.api import files, git

app.include_router(files.router, prefix="/api", tags=["files"])
app.include_router(git.router, prefix="/api", tags=["git"])

from backend.v2_routes import router as v2_router

app.include_router(v2_router, tags=["v2"])

from backend.agui_endpoint import router as agui_router

app.include_router(agui_router, tags=["ag-ui"])
