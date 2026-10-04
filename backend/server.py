from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import time
import uuid
import logging
import asyncio
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Annotated, Optional, Literal

import requests
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Request, UploadFile, File, Form
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from emailer import send_email, submission_email

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]
OWNER_EMAIL = os.environ['OWNER_EMAIL']

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ["EMERGENT_LLM_KEY"]
APP_NAME = "spytick"
ALLOWED_IMAGES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
MAX_UPLOAD = 5 * 1024 * 1024
storage_key = None


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)


class Contact(BaseDocument):
    name: str
    email: str
    message: str
    email_sent: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Feedback(BaseDocument):
    name: str
    email: str
    category: str
    message: str
    screenshot_path: Optional[str] = None
    screenshot_filename: Optional[str] = None
    email_sent: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=1, max_length=5000)


Category = Literal["Feedback", "Bug Report", "Feature Request"]

_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request, limit: int = 6, window: int = 600):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="Too many submissions. Try again in a few minutes.")
    q.append(now)


async def notify(collection: str, doc_id, kind: str, fields: list, reply_to: str):
    try:
        subject, html = submission_email(kind, fields)
        await send_email(to=OWNER_EMAIL, subject=subject, html=html, reply_to=reply_to)
        await db[collection].update_one({"_id": doc_id}, {"$set": {"email_sent": True}})
    except Exception as e:
        logger.error(f"Email notify failed for {collection}: {e}")


app = FastAPI()
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "SPYtick API"}


@api_router.post("/contact")
async def create_contact(payload: ContactIn, request: Request):
    rate_limit(request)
    item = Contact(name=payload.name.strip(), email=str(payload.email), message=payload.message.strip())
    res = await db.contacts.insert_one(item.to_mongo())
    asyncio.create_task(notify("contacts", res.inserted_id, "contact message",
                               [("Name", item.name), ("Email", item.email), ("Message", item.message)], item.email))
    return {"ok": True, "id": str(res.inserted_id)}


@api_router.post("/feedback")
async def create_feedback(
    request: Request,
    name: str = Form(..., min_length=1, max_length=120),
    email: EmailStr = Form(...),
    category: Category = Form(...),
    message: str = Form(..., min_length=1, max_length=5000),
    screenshot: Optional[UploadFile] = File(None),
):
    rate_limit(request)
    shot_path, shot_name = None, None
    if screenshot is not None and screenshot.filename:
        ext = ALLOWED_IMAGES.get(screenshot.content_type or "")
        if not ext:
            raise HTTPException(status_code=400, detail="Screenshot must be a PNG, JPG, WEBP or GIF image.")
        data = await screenshot.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(status_code=400, detail="Screenshot must be under 5 MB.")
        try:
            result = await asyncio.to_thread(put_object, f"{APP_NAME}/feedback/{uuid.uuid4()}.{ext}", data,
                                             screenshot.content_type)
            shot_path, shot_name = result["path"], screenshot.filename
        except Exception as e:
            logger.error(f"Screenshot upload failed: {e}")
            raise HTTPException(status_code=502, detail="Could not upload the screenshot. Try again without it.")
    item = Feedback(name=name.strip(), email=str(email), category=category, message=message.strip(),
                    screenshot_path=shot_path, screenshot_filename=shot_name)
    res = await db.feedback.insert_one(item.to_mongo())
    fields = [("Category", item.category), ("Name", item.name), ("Email", item.email), ("Message", item.message),
              ("Screenshot", f"{shot_name} (stored at {shot_path})" if shot_path else "None")]
    asyncio.create_task(notify("feedback", res.inserted_id, item.category.lower(), fields, item.email))
    return {"ok": True, "id": str(res.inserted_id), "screenshot_stored": bool(shot_path)}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
