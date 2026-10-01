import { avatar } from "./avatar.js";

const $ = (id) => document.getElementById(id);

const messages = $("messages");
const input = $("input");
const send = $("send");
const status = $("status");
const serverState = $("serverState");
const emotion = $("emotion");

let history = [];
let audioQueue = Promise.resolve();

function apiBase() {
  const stored = localStorage.getItem("aizunda-api");

  if (stored) {
    return stored.replace(/\/$/, "");
  }

  return location.protocol.startsWith("http")
    ? location.origin
    : "http://127.0.0.1:8000";
}

function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "message " + role;

  const who = document.createElement("div");
  who.className = "who";
  who.textContent =
    role === "assistant"
      ? "ずんだもん"
      : "あなた";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text || "";

  wrap.append(who, bubble);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;

  return bubble;
}

function setStatus(text, state) {
  status.textContent = text;
  serverState.className = "state " + (state || "");
}

function emotionLabel(data) {
  if (!data) {
    return "平常";
  }

  const pairs = Object.entries(data)
    .sort((a, b) => b[1] - a[1]);

  if (!pairs.length || pairs[0][1] < 0.24) {
    return "平常";
  }

  const labels = {
    happy: "ごきげん",
    surprise: "びっくり",
    sad: "しょんぼり",
    angry: "おこり気味",
    confused: "困惑"
  };

  return labels[pairs[0][0]] || "平常";
}

function enqueueSpeech(text) {
  const clean = text.trim();

  if (!clean) {
    return;
  }

  audioQueue = audioQueue.then(async () => {
    try {
      const response = await fetch(
        apiBase() + "/api/tts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: clean,
            speaker: Number(
              localStorage.getItem(
                "aizunda-speaker"
              ) || 3
            )
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await response.text()
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      await audio.play();

      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
      });

      URL.revokeObjectURL(url);
    } catch {
      if (!("speechSynthesis" in window)) {
        return;
      }

      await new Promise((resolve) => {
        const utterance =
          new SpeechSynthesisUtterance(clean);

        utterance.lang = "ja-JP";
        utterance.rate = 1.08;
        utterance.onend = resolve;
        utterance.onerror = resolve;

        speechSynthesis.speak(utterance);
      });
    }
  });
}

async function health() {
  try {
    const response = await fetch(
      apiBase() + "/api/health",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("health");
    }

    const data = await response.json();

    if (data.llmState === "ready") {
      setStatus(
        "AI準備完了 / " + data.device,
        "ok"
      );
      return;
    }

    if (data.llmState === "loading") {
      setStatus(
        "AIモデルを準備中なのだ…",
        "ok"
      );
      return;
    }

    if (data.llmState === "error") {
      setStatus(
        "AIモデル準備エラーなのだ: " +
        (data.llmError || "不明なエラー"),
        "bad"
      );
      return;
    }

    setStatus(
      "AIサーバー接続済み / モデル待機中なのだ",
      "ok"
    );
  } catch {
    setStatus(
      "AIサーバーに接続できないのだ",
      "bad"
    );
  }
}

async function sendMessage() {
  const text = input.value.trim();

  if (!text || send.disabled) {
    return;
  }

  input.value = "";

  addMessage("user", text);
  const bubble = addMessage(
    "assistant",
    "考えているのだ…"
  );

  send.disabled = true;
  input.disabled = true;

  history.push({
    role: "user",
    content: text
  });

  const requestHistory = history
    .slice(0, -1)
    .slice(-8);

  let full = "";

  setStatus("考え中なのだ…", "ok");

  try {
    const response = await fetch(
      apiBase() + "/api/chat/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: text,
          history: requestHistory
        })
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(
        await response.text()
      );
    }

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();

    let buffer = "";

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += result.value;

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        const line = block
          .split("\n")
          .find((item) =>
            item.startsWith("data: ")
          );

        if (!line) {
          continue;
        }

        const event = JSON.parse(
          line.slice(6)
        );

        if (event.type === "delta") {
          if (!full) {
            bubble.textContent = "";
          }

          full += event.text;
          bubble.textContent = full;

          messages.scrollTop =
            messages.scrollHeight;
        }

        if (event.type === "sentence") {
          enqueueSpeech(event.text);
        }

        if (event.type === "done") {
          full = event.text;
          bubble.textContent = full;

          avatar.apply(
            event.performance
          );

          emotion.textContent =
            emotionLabel(
              event.performance?.emotion
            );
        }

        if (event.type === "error") {
          throw new Error(
            event.message
          );
        }
      }
    }

    history.push({
      role: "assistant",
      content: full
    });

    setStatus("待機中なのだ", "ok");
  } catch (error) {
    bubble.textContent =
      "通信に失敗したのだ。\n" +
      error.message;

    setStatus(
      "接続エラーなのだ",
      "bad"
    );
  } finally {
    send.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

$("vrm").addEventListener(
  "change",
  async (event) => {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus(
      "VRMを読み込み中なのだ…"
    );

    try {
      await avatar.load(file);

      $("empty").classList.add("hide");
      setStatus(
        "VRM読み込み完了なのだ",
        "ok"
      );
    } catch (error) {
      setStatus(
        "VRM読み込み失敗: " +
        error.message,
        "bad"
      );
    }
  }
);

$("reset").addEventListener(
  "click",
  () => {
    avatar.plan = null;

    if (avatar.vrm?.humanoid) {
      for (const name of [
        "head",
        "chest",
        "leftUpperArm",
        "rightUpperArm"
      ]) {
        const bone =
          avatar.vrm.humanoid
            .getNormalizedBoneNode(name);

        if (bone) {
          bone.rotation.set(0, 0, 0);
        }
      }
    }
  }
);

$("clear").addEventListener(
  "click",
  () => {
    history = [];

    messages.innerHTML = "";

    addMessage(
      "assistant",
      "会話を忘れたのだ。もう一度よろしくなのだ！"
    );
  }
);

send.addEventListener(
  "click",
  sendMessage
);

input.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      sendMessage();
    }
  }
);

$("settings").addEventListener(
  "click",
  () => {
    $("api").value = apiBase();
    $("speaker").value =
      localStorage.getItem(
        "aizunda-speaker"
      ) || "3";

    $("dialog").showModal();
  }
);

$("save").addEventListener(
  "click",
  (event) => {
    event.preventDefault();

    const url =
      $("api").value
        .trim()
        .replace(/\/$/, "");

    const speaker =
      $("speaker").value || "3";

    if (url) {
      localStorage.setItem(
        "aizunda-api",
        url
      );
    } else {
      localStorage.removeItem(
        "aizunda-api"
      );
    }

    localStorage.setItem(
      "aizunda-speaker",
      speaker
    );

    $("dialog").close();

    health();
  }
);

let recognition = null;

if (
  "SpeechRecognition" in window ||
  "webkitSpeechRecognition" in window
) {
  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    input.value =
      event.results[0][0].transcript;

    input.focus();
  };

  recognition.onerror = () => {
    setStatus(
      "音声入力でエラーなのだ",
      "bad"
    );
  };
}

$("mic").addEventListener(
  "click",
  () => {
    if (!recognition) {
      setStatus(
        "このブラウザは音声入力に対応していないのだ",
        "bad"
      );
      return;
    }

    setStatus(
      "聞いているのだ…",
      "ok"
    );

    recognition.start();
  }
);

health();
setInterval(health, 1500);
input.focus();
