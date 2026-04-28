import os
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

OPENROUTER_API_KEY = os.environ["OPENROUTER_API_KEY"]

# Free models available on OpenRouter (change as needed):
#   google/gemma-3-27b-it:free
#   meta-llama/llama-4-scout:free
#   microsoft/phi-4-reasoning:free
#   deepseek/deepseek-r1:free
MODEL = "anthropic/claude-3.5-haiku"

# OpenRouter exposes the same interface as the OpenAI API, so the payload is identical
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

app = FastAPI()

# Allows the Vite frontend (port 5173) to call this server during development.
# In production this should be restricted to the real domain or removed if
# frontend and backend are served from the same origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sessions stored in memory: reset on server restart.
sessions: list[dict] = []


@app.post("/api/chat")
async def chat(request: Request):
    """
    Proxy to OpenRouter. The client sends the messages, the server adds the API key
    in the Authorization header and returns the model response as-is.
    The API key is never exposed to the browser.
    """
    body = await request.json()
    # High timeout because free models can have significant latency
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            OPENROUTER_URL,
            headers={
                # OpenRouter uses Bearer token for authentication
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                # Generous limit: interviewer responses include feedback + next question
                "max_tokens": 1200,
                # The frontend already sends messages in OpenAI format (system + history)
                "messages": body["messages"],
            },
        )
    # Returns the raw OpenRouter response; the frontend reads choices[0].message.content
    return response.json()


@app.post("/api/sessions")
async def create_session(request: Request):
    """Saves a new session. The id is an incremental integer based on the current list length."""
    body = await request.json()
    # Server id comes last so it always overrides any id sent by the client
    session = {**body, "id": len(sessions) + 1}
    sessions.append(session)
    return session


@app.get("/api/sessions")
async def get_sessions():
    """Returns all sessions stored in memory."""
    return sessions


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: int):
    """Looks up a session by id; returns a JSON error if not found."""
    session = next((s for s in sessions if s["id"] == session_id), None)
    if not session:
        return {"error": "Session not found"}
    return session


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int):
    """Removes the session from the in-memory list. global is needed to reassign the list."""
    global sessions
    sessions = [s for s in sessions if s["id"] != session_id]
    return {"ok": True}
