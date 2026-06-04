from fastapi import APIRouter
from app.api.v1 import ai, auth, workspaces, notes, comments, search

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(workspaces.router)
api_router.include_router(notes.router)
api_router.include_router(comments.router)
api_router.include_router(search.router)
api_router.include_router(ai.router)
