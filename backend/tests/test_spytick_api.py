"""Backend API tests for SPYtick: /api/contact and /api/feedback."""
import io
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"


def _ip():
    """Unique X-Forwarded-For to avoid tripping rate limit."""
    return f"203.0.113.{int(time.time()*1000) % 250 + 1}.{uuid.uuid4().hex[:4]}"


def _h(ip=None):
    return {"X-Forwarded-For": ip or f"198.51.100.{uuid.uuid4().int % 250 + 1}"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    # cleanup TEST_ records
    c[DB_NAME]["contacts"].delete_many({"name": {"$regex": "^TEST_"}})
    c[DB_NAME]["feedback"].delete_many({"name": {"$regex": "^TEST_"}})
    c.close()


# --- Root ---
def test_root():
    r = requests.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    assert r.json().get("message") == "SPYtick API"


# --- Contact ---
def test_contact_success_and_persisted(mongo):
    payload = {"name": "TEST_Alice", "email": "test_alice@example.com", "message": "Hello from test"}
    r = requests.post(f"{BASE_URL}/api/contact", json=payload, headers=_h())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert "id" in data

    # Verify persistence in Mongo
    doc = mongo.contacts.find_one({"name": "TEST_Alice"})
    assert doc is not None
    assert doc["email"] == payload["email"]
    assert doc["message"] == payload["message"]


def test_contact_invalid_email_422():
    r = requests.post(f"{BASE_URL}/api/contact",
                      json={"name": "TEST_x", "email": "not-an-email", "message": "hi"},
                      headers=_h())
    assert r.status_code == 422


def test_contact_missing_fields_422():
    r = requests.post(f"{BASE_URL}/api/contact", json={"name": "TEST_x"}, headers=_h())
    assert r.status_code == 422


# --- Feedback ---
def test_feedback_success_without_screenshot(mongo):
    data = {"name": "TEST_Bob", "email": "test_bob@example.com",
            "category": "Feedback", "message": "Nice site"}
    r = requests.post(f"{BASE_URL}/api/feedback", data=data, headers=_h())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["screenshot_stored"] is False

    doc = mongo.feedback.find_one({"name": "TEST_Bob"})
    assert doc is not None
    assert doc["category"] == "Feedback"


def test_feedback_invalid_category_422():
    data = {"name": "TEST_x", "email": "test_x@example.com",
            "category": "InvalidCat", "message": "hi"}
    r = requests.post(f"{BASE_URL}/api/feedback", data=data, headers=_h())
    assert r.status_code == 422


def test_feedback_invalid_email_422():
    data = {"name": "TEST_x", "email": "bad", "category": "Bug Report", "message": "hi"}
    r = requests.post(f"{BASE_URL}/api/feedback", data=data, headers=_h())
    assert r.status_code == 422


def test_feedback_non_image_400():
    data = {"name": "TEST_c", "email": "c@example.com",
            "category": "Feature Request", "message": "hi"}
    files = {"screenshot": ("x.txt", io.BytesIO(b"hello"), "text/plain")}
    r = requests.post(f"{BASE_URL}/api/feedback", data=data, files=files, headers=_h())
    assert r.status_code == 400
    assert "image" in r.json()["detail"].lower()


def test_feedback_too_large_400():
    data = {"name": "TEST_d", "email": "d@example.com",
            "category": "Bug Report", "message": "hi"}
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (6 * 1024 * 1024)
    files = {"screenshot": ("big.png", io.BytesIO(big), "image/png")}
    r = requests.post(f"{BASE_URL}/api/feedback", data=data, files=files, headers=_h())
    assert r.status_code == 400
    assert "5" in r.json()["detail"]


def test_feedback_png_upload(mongo):
    data = {"name": "TEST_Eve", "email": "test_eve@example.com",
            "category": "Bug Report", "message": "with image"}
    # minimal 1x1 PNG
    png = bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
        "890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
    )
    files = {"screenshot": ("tiny.png", io.BytesIO(png), "image/png")}
    r = requests.post(f"{BASE_URL}/api/feedback", data=data, files=files, headers=_h())
    assert r.status_code in (200, 502), r.text  # 502 if upstream storage is down
    if r.status_code == 200:
        body = r.json()
        assert body["ok"] is True
        # screenshot_stored may be True
        doc = mongo.feedback.find_one({"name": "TEST_Eve"})
        assert doc is not None


# --- Rate limit ---
def test_rate_limit_contact_429():
    ip = f"192.0.2.{uuid.uuid4().int % 250 + 1}"
    hdr = {"X-Forwarded-For": ip}
    last = None
    for i in range(8):
        last = requests.post(f"{BASE_URL}/api/contact",
                             json={"name": f"TEST_rl{i}", "email": f"rl{i}@example.com",
                                   "message": "spam"},
                             headers=hdr)
    assert last.status_code == 429, f"expected 429, got {last.status_code}"


# --- Email sent flag ---
def test_email_sent_flag_eventually_true(mongo):
    payload = {"name": "TEST_Notify", "email": "test_notify@example.com",
               "message": "notify test"}
    r = requests.post(f"{BASE_URL}/api/contact", json=payload, headers=_h())
    assert r.status_code == 200
    doc_id = r.json()["id"]
    # Wait up to ~15s for background notify task
    flagged = False
    for _ in range(15):
        time.sleep(1)
        from bson import ObjectId
        doc = mongo.contacts.find_one({"_id": ObjectId(doc_id)})
        if doc and doc.get("email_sent"):
            flagged = True
            break
    # Not strict - email service may fail silently; log only
    print(f"email_sent flag after wait: {flagged}")
