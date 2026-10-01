from __future__ import annotations

import os
import threading

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TextIteratorStreamer,
)


SYSTEM_PROMPT = """あなたはブラウザで動くAIずんだもんなのだ。
一人称は「ぼく」。
自然な日本語で答える。
できるだけ短く分かりやすく答える。
語尾は基本的に「なのだ」。
質問にちゃんと答え、分からないことは分からないと言う。
"""


class LLMAdapter:
    def __init__(self) -> None:
        self.model_name = os.getenv(
            "AIZUNDA_MODEL",
            "rinna/japanese-gpt-neox-3.6b-instruction-sft",
        )
        self.max_new_tokens = int(
            os.getenv("AIZUNDA_MAX_NEW_TOKENS", "160")
        )
        self.temperature = float(
            os.getenv("AIZUNDA_TEMPERATURE", "0.75")
        )
        self.top_p = float(
            os.getenv("AIZUNDA_TOP_P", "0.9")
        )

        self.device = (
            "cuda" if torch.cuda.is_available() else "cpu"
        )

        # Load only when the first AI request arrives.
        # This keeps the browser UI fast even on a fresh machine.
        self.tokenizer = None
        self.model = None
        self._load_lock = threading.Lock()
        self._generate_lock = threading.Lock()

    def _ensure_loaded(self) -> None:
        if self.model is not None:
            return

        with self._load_lock:
            if self.model is not None:
                return

            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                use_fast=False,
            )

            dtype = (
                torch.float16
                if self.device == "cuda"
                else torch.float32
            )

            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                torch_dtype=dtype,
            ).to(self.device)

            self.model.eval()

    def _build_prompt(
        self,
        message: str,
        history: list[dict[str, str]],
    ) -> str:
        prompt = (
            f"システム: {SYSTEM_PROMPT}<NL>"
        )

        for item in history[-8:]:
            role = item.get("role", "user")
            content = str(
                item.get("content", "")
            ).strip()

            if not content:
                continue

            if role == "assistant":
                prompt += (
                    f"ずんだもん: {content}<NL>"
                )
            else:
                prompt += (
                    f"ユーザー: {content}<NL>"
                )

        prompt += (
            f"ユーザー: {message.strip()}"
            "<NL>システム: "
        )

        return prompt

    def stream_chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
    ):
        history = history or []
        self._ensure_loaded()

        assert self.model is not None
        assert self.tokenizer is not None

        with self._generate_lock:
            prompt = self._build_prompt(
                message,
                history,
            )

            encoded = self.tokenizer(
                prompt,
                return_tensors="pt",
                add_special_tokens=False,
            )

            encoded = {
                key: value.to(self.model.device)
                for key, value in encoded.items()
            }

            streamer = TextIteratorStreamer(
                self.tokenizer,
                skip_prompt=True,
                skip_special_tokens=True,
            )

            kwargs = {
                **encoded,
                "streamer": streamer,
                "max_new_tokens": self.max_new_tokens,
                "do_sample": self.temperature > 0,
                "temperature": max(
                    0.05,
                    self.temperature,
                ),
                "top_p": self.top_p,
                "repetition_penalty": 1.05,
                "pad_token_id": (
                    self.tokenizer.pad_token_id
                ),
                "eos_token_id": (
                    self.tokenizer.eos_token_id
                ),
            }

            worker = threading.Thread(
                target=self.model.generate,
                kwargs=kwargs,
                daemon=True,
            )
            worker.start()

            for piece in streamer:
                if piece:
                    yield piece

            worker.join(timeout=2)

    def create_chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
    ) -> str:
        return "".join(
            self.stream_chat(
                message,
                history or [],
            )
        ).strip()
