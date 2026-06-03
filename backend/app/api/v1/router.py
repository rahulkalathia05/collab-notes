from fastapi import APIRouter
from app.api.v1 import auth, workspaces, notes

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(workspaces.router)
api_router.include_router(notes.router)
