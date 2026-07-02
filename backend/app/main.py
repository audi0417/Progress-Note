import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.routers import notes, sessions, ws
from app.services.asr import get_asr_engine

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Eagerly load the ASR model (no-op for the mock backend) so the first
    # websocket connection isn't slowed down by a cold model load.
    await get_asr_engine().warmup()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(notes.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "asr_backend": settings.asr_backend}
