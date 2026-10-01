from __future__ import annotations

import random


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def detect_emotion(text: str) -> dict[str, float]:
    patterns = {
        "happy": ["うれ", "楽しい", "最高", "好き", "ありがとう", "！"],
        "surprise": ["えっ", "本当", "まじ", "！？", "!?"],
        "sad": ["悲しい", "つらい", "ごめん", "残念", "泣"],
        "angry": ["怒", "むかつ", "最悪", "嫌い"],
        "confused": ["わから", "どういう", "謎", "意味不明"],
    }

    score = {
        name: 0.08
        for name in patterns
    }

    for name, words in patterns.items():
        for word in words:
            score[name] += 0.13 * text.count(word)

    total = sum(score.values()) or 1
    return {
        name: round(clamp(value / total * 1.8, 0, 1), 3)
        for name, value in score.items()
    }


def build_performance(text: str) -> dict:
    emotion = detect_emotion(text)

    instability = 0.03

    if any(x in text for x in ["？？", "???", "意味不明", "バグ", "壊れた"]):
        instability += 0.30

    if random.random() < 0.025:
        instability += 0.50

    tilt = (
        0.04
        + emotion["confused"] * 0.25
        - emotion["sad"] * 0.10
        + instability * 0.10
    )
    arm = (
        0.12
        + emotion["surprise"] * 0.55
        + emotion["happy"] * 0.25
        + instability * 0.15
    )

    # These are parameterized keyframes, not named canned animations.
    frames = [
        {
            "t": 0.0,
            "bones": {
                "head": [0.0, 0.0, 0.0],
                "chest": [0.0, 0.0, 0.0],
                "leftUpperArm": [0.0, 0.0, 0.0],
                "rightUpperArm": [0.0, 0.0, 0.0],
            },
        },
        {
            "t": 0.32,
            "bones": {
                "head": [0.0, tilt, -tilt * 0.25],
                "chest": [0.0, 0.0, 0.05 * instability],
                "leftUpperArm": [0.0, 0.0, arm],
                "rightUpperArm": [0.0, 0.0, -arm],
            },
        },
        {
            "t": 0.62,
            "bones": {
                "head": [0.0, -tilt * 0.25, tilt * 0.15],
                "chest": [0.0, 0.0, -0.04 * instability],
                "leftUpperArm": [0.0, 0.0, arm * 0.65],
                "rightUpperArm": [0.0, 0.0, -arm * 0.65],
            },
        },
        {
            "t": 1.0,
            "bones": {
                "head": [0.0, 0.0, 0.0],
                "chest": [0.0, 0.0, 0.0],
                "leftUpperArm": [0.0, 0.0, 0.0],
                "rightUpperArm": [0.0, 0.0, 0.0],
            },
        },
    ]

    if instability > 0.4:
        for frame in frames[1:3]:
            frame["bones"]["head"][1] += random.choice([-0.16, 0.16])
            frame["bones"]["head"][2] += random.choice([-0.10, 0.10])

    return {
        "emotion": emotion,
        "instability": round(clamp(instability, 0, 1), 3),
        "durationMs": int(1200 + instability * 1100),
        "keyframes": frames,
        "limits": {
            "maxRotationRad": 0.9,
        },
    }
