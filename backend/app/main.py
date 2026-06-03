from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.redis import close_pool
from app.db.session import engine
from app.ws.router import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting {} (debug={})", settings.APP_NAME, settings.DEBUG)
    yield
    logger.info("Shutting down — closing DB and Redis pools")
    await engine.dispose()
    await close_pool()


def create_app() -> FastAPI:
    setup_logging(settings.DEBUG)

    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.DEBUG else None,
        redoc_url="/api/redoc" if settings.DEBUG else None,
        openapi_url="/api/openapi.json" if settings.DEBUG else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api/v1")
    app.include_router(ws_router)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on {} {}", request.method, request.url)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"},
        )

    @app.get("/health", tags=["health"])
    async def health():
        return {"status": "ok", "version": "1.0.0"}

    return app


app = create_app()
