from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from llm_adapter import LLMAdapter
from performance import build_performance
from voicevox_adapter import VoicevoxAdapter, VoicevoxError


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"

app = FastAPI(
    title="AI Zundamon Browser",
    version="0.1.0",
)

# Useful for GitHub Pages or another static host talking to this local server.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

llm = LLMAdapter()
voicevox = VoicevoxAdapter()


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(
        default_factory=list,
        max_length=12,
    )


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    speaker: int | None = None


def sse(payload: dict) -> str:
    return (
        "data: "
        + json.dumps(payload, ensure_ascii=False)
        + "\n\n"
    )


def split_sentence(buffer: str):
    for index, char in enumerate(buffer):
        if char in "。！？!?\n":
            return buffer[: index + 1], buffer[index + 1 :]
    return "", buffer


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "device": llm.device,
        "model": llm.model_name,
        "voicevox": voicevox.health(),
    }


@app.get("/api/voicevox/speakers")
def speakers():
    try:
        return voicevox.get_speakers()
    except VoicevoxError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc


@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    def generate():
        full_text = ""
        buffer = ""

        try:
            yield sse({"type": "start"})

            history = [
                item.model_dump()
                for item in request.history
            ]

            for piece in llm.stream_chat(
                request.message,
                history,
            ):
                full_text += piece
                buffer += piece

                yield sse({
                    "type": "delta",
                    "text": piece,
                })

                while True:
                    sentence, buffer = split_sentence(buffer)

                    if not sentence:
                        break

                    yield sse({
                        "type": "sentence",
                        "text": sentence.strip(),
                    })

            if buffer.strip():
                yield sse({
                    "type": "sentence",
                    "text": buffer.strip(),
                })

            text = (
                full_text.strip()
                or "うまく言葉が出てこなかったのだ……"
            )

            yield sse({
                "type": "done",
                "text": text,
                "performance": build_performance(text),
            })

        except Exception as exc:
            yield sse({
                "type": "error",
                "message": f"AI処理に失敗しました: {exc}",
            })

    return StreamingResponse(
        generate(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/tts")
def tts(request: TTSRequest):
    try:
        audio = voicevox.get_voice(
            request.text,
            request.speaker,
        )

        return Response(
            content=audio,
            media_type="audio/wav",
        )

    except VoicevoxError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host=os.getenv("AIZUNDA_HOST", "127.0.0.1"),
        port=int(os.getenv("AIZUNDA_PORT", "8000")),
        reload=False,
    )
