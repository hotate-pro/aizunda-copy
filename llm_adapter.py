from __future__ import annotations

import os
import queue
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
            "rinna/japanese-gpt-neox-3.6b-instruction-sft-v2",
        )

        if (
            self.model_name
            == "rinna/japanese-gpt-neox-3.6b-instruction-sft"
        ):
            self.model_name = (
                "rinna/japanese-gpt-neox-3.6b-instruction-sft-v2"
            )

        self.max_new_tokens = int(
            os.getenv("AIZUNDA_MAX_NEW_TOKENS", "96")
        )
        self.temperature = float(
            os.getenv("AIZUNDA_TEMPERATURE", "0.7")
        )
        self.top_p = float(
            os.getenv("AIZUNDA_TOP_P", "0.9")
        )

        self.device = (
            "cuda" if torch.cuda.is_available() else "cpu"
        )

        self.tokenizer = None
        self.model = None

        self._load_lock = threading.Lock()
        self._generate_lock = threading.Lock()
        self._state_lock = threading.Lock()

        self._state = "unloaded"
        self._error = None

    @property
    def state(self) -> str:
        with self._state_lock:
            return self._state

    @property
    def error(self):
        with self._state_lock:
            return self._error

    def _set_state(
        self,
        state: str,
        error=None,
    ) -> None:
        with self._state_lock:
            self._state = state
            self._error = error

    def ensure_loaded(self) -> None:
        if self.model is not None:
            self._set_state("ready")
            return

        with self._load_lock:
            if self.model is not None:
                self._set_state("ready")
                return

            self._set_state("loading")

            try:
                self.tokenizer = (
                    AutoTokenizer.from_pretrained(
                        self.model_name,
                        use_fast=False,
                    )
                )

                # device_map=auto requires Accelerate and allows
                # Transformers to offload layers when VRAM is small.
                self.model = (
                    AutoModelForCausalLM.from_pretrained(
                        self.model_name,
                        device_map="auto",
                        torch_dtype="auto",
                        low_cpu_mem_usage=True,
                    )
                )

                self.model.eval()
                self._set_state("ready")

            except Exception as exc:
                self.tokenizer = None
                self.model = None
                self._set_state(
                    "error",
                    f"{type(exc).__name__}: {exc}",
                )
                raise

    def _build_prompt(
        self,
        message: str,
        history: list[dict[str, str]],
    ) -> str:
        prompt = (
            f"システム: {SYSTEM_PROMPT}<NL>"
        )

        for item in history[-8:]:
            role = item.get(
                "role",
                "user",
            )
            content = str(
                item.get(
                    "content",
                    "",
                )
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
        self.ensure_loaded()

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

            input_device = next(
                self.model.parameters()
            ).device

            encoded = {
                key: value.to(input_device)
                for key, value in encoded.items()
            }

            streamer = TextIteratorStreamer(
                self.tokenizer,
                skip_prompt=True,
                skip_special_tokens=True,
                timeout=1.0,
            )

            generation_error = []

            def run_generation():
                try:
                    with torch.inference_mode():
                        self.model.generate(
                            **encoded,
                            streamer=streamer,
                            max_new_tokens=self.max_new_tokens,
                            do_sample=self.temperature > 0,
                            temperature=max(
                                0.05,
                                self.temperature,
                            ),
                            top_p=self.top_p,
                            repetition_penalty=1.1,
                            pad_token_id=(
                                self.tokenizer.pad_token_id
                            ),
                            eos_token_id=(
                                self.tokenizer.eos_token_id
                            ),
                        )
                except BaseException as exc:
                    generation_error.append(exc)
                    streamer.on_finalized_text(
                        "",
                        stream_end=True,
                    )

            worker = threading.Thread(
                target=run_generation,
                daemon=True,
            )
            worker.start()

            try:
                while worker.is_alive():
                    try:
                        piece = next(streamer)
                    except queue.Empty:
                        continue

                    if piece:
                        yield piece

                # Drain anything finalized just before the worker exited.
                while True:
                    try:
                        piece = next(streamer)
                    except (queue.Empty, StopIteration):
                        break

                    if piece:
                        yield piece

            except StopIteration:
                pass

            worker.join(timeout=2)

            if generation_error:
                raise RuntimeError(
                    "モデル生成に失敗しました: "
                    + str(generation_error[0])
                )

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
