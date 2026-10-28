"""Uvicorn entry point; one worker retains in-process room state."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import JSONResponse

from .auth import router
from .config import Settings
from .db import connect_database, disconnect_database
from .schemas import HealthRead


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await run_in_threadpool(connect_database, settings)
        try:
            yield
        finally:
            await run_in_threadpool(disconnect_database)

    application = FastAPI(title="MetaMuseum API", version="1.0.0", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(SessionMiddleware, secret_key=settings.secret_key,
                               session_cookie=settings.session_cookie, max_age=settings.session_max_age,
                               same_site="lax", https_only=settings.session_secure)
    application.include_router(router)

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        # Pydantic's default error includes input values, which may be passwords.
        details = [{k: item[k] for k in ("type", "loc", "msg")} for item in error.errors()]
        return JSONResponse({"detail": "validation_error", "errors": details}, status_code=422)

    @application.get("/health", response_model=HealthRead)
    def health():
        from mongoengine.connection import get_connection
        from pymongo.errors import PyMongoError
        from fastapi import HTTPException
        try:
            get_connection().admin.command("ping")
        except PyMongoError:
            raise HTTPException(503, "database_unavailable") from None
        return HealthRead(status="ok")

    return application


class _ConfiguredApplication:
    """Delay required environment loading until ASGI startup, allowing clean imports."""
    def __init__(self):
        self.application = None

    async def __call__(self, scope, receive, send):
        if self.application is None:
            self.application = create_app()
        await self.application(scope, receive, send)


app = _ConfiguredApplication()
