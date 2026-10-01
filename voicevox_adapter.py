from __future__ import annotations

import os

import requests


class VoicevoxError(RuntimeError):
    pass


class VoicevoxAdapter:
    def __init__(self) -> None:
        self.url = os.getenv(
            "VOICEVOX_URL",
            "http://127.0.0.1:50021",
        ).rstrip("/")
        self.speaker_id = int(os.getenv("VOICEVOX_SPEAKER", "3"))
        self.timeout = float(os.getenv("VOICEVOX_TIMEOUT", "30"))

    def health(self) -> bool:
        try:
            response = requests.get(
                f"{self.url}/version",
                timeout=2,
            )
            return response.ok
        except requests.RequestException:
            return False

    def get_speakers(self):
        try:
            response = requests.get(
                f"{self.url}/speakers",
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            raise VoicevoxError(
                f"VOICEVOXへ接続できません: {exc}"
            ) from exc

    def get_voice(
        self,
        text: str,
        speaker_id: int | None = None,
    ) -> bytes:
        text = text.strip()

        if not text:
            raise VoicevoxError("音声化する文章が空です")

        speaker = (
            self.speaker_id
            if speaker_id is None
            else int(speaker_id)
        )

        try:
            query = requests.post(
                f"{self.url}/audio_query",
                params={
                    "text": text,
                    "speaker": speaker,
                },
                timeout=self.timeout,
            )
            query.raise_for_status()

            synthesis = requests.post(
                f"{self.url}/synthesis",
                params={"speaker": speaker},
                json=query.json(),
                timeout=self.timeout,
            )
            synthesis.raise_for_status()

            return synthesis.content
        except requests.RequestException as exc:
            raise VoicevoxError(
                f"VOICEVOX音声合成に失敗しました: {exc}"
            ) from exc
