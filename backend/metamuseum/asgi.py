"""Uvicorn entry point; one worker retains in-process room state."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import http_exception_handler
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

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
            from .services.wall_media import cleanup
            await run_in_threadpool(cleanup, settings)
            yield
        finally:
            try:
                if hasattr(app.state, 'realtime'):
                    await app.state.realtime.shutdown()
            finally:
                await run_in_threadpool(app.state.streams.close)
            await run_in_threadpool(disconnect_database)

    application = FastAPI(title="MetaMuseum API", version="1.0.0", lifespan=lifespan)
    application.state.settings = settings
    from .services.streams import StreamManager
    from .services.providers import RateLimiter
    application.state.streams = StreamManager(settings.stream_root, settings.ffmpeg_path)
    application.state.integration_limiter = RateLimiter()
    application.add_middleware(SessionMiddleware, secret_key=settings.secret_key,
                               session_cookie=settings.session_cookie, max_age=settings.session_max_age,
                               same_site="lax", https_only=settings.session_secure)
    application.include_router(router)
    from .api import admin, gallery, legacy, wall_designs, wall_media, integrations, avatars, gaussian_dev
    application.middleware('http')(integrations.bounded_integration_body)
    application.include_router(integrations.router)
    application.include_router(wall_designs.router)
    application.include_router(wall_media.router)
    application.include_router(gallery.router)
    application.include_router(avatars.router)
    application.include_router(gaussian_dev.router)
    application.include_router(admin.router)
    application.include_router(legacy.router)
    # Existing media URLs keep their /static prefix, independently of the React build.
    if settings.media_root and settings.media_root.is_dir():
        application.mount('/static', StaticFiles(directory=settings.media_root), name='legacy-static')
    if settings.frontend_root and (settings.frontend_root / 'assets').is_dir():
        application.mount('/assets', StaticFiles(directory=settings.frontend_root / 'assets'), name='frontend-assets')

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

    @application.exception_handler(StarletteHTTPException)
    async def frontend_file(request: Request, error: StarletteHTTPException):
        from starlette.responses import FileResponse
        path = request.url.path.lstrip('/')
        root = settings.frontend_root
        if (error.status_code == 404 and request.method in {'GET', 'HEAD'} and root
                and path != 'api' and not path.startswith(('api/', 'static/'))):
            target = (root / path).resolve()
            if target.is_relative_to(root.resolve()) and target.is_file():
                return FileResponse(target)
        return await http_exception_handler(request, error)

    return application


def create_realtime_app(http_app: FastAPI):
    from .realtime import create_realtime_app as wrap
    return wrap(http_app)


class _ConfiguredApplication:
    """Delay required environment loading until ASGI startup, allowing clean imports."""
    def __init__(self):
        self.application = None

    async def __call__(self, scope, receive, send):
        if self.application is None:
            self.application = create_realtime_app(create_app())
        await self.application(scope, receive, send)


app = _ConfiguredApplication()
