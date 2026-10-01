# AIずんだもん Browser Edition

YouTube LiveとOBSを前提にしていたAIずんだもん構成を、**ブラウザ中心に置き換えた版**です。

元の `yuzu-krs/ai-zunda` にある
「LLM → VOICEVOX → AITuber」
という流れを残しつつ、入力と出力をYouTube/OBSからWebへ移します。

## 変更点

- YouTube Liveコメント取得を使用しない
- OBS WebSocketを使用しない
- VB-CABLEなどの仮想音声デバイスを使用しない
- ブラウザの入力欄からAIへ質問
- AI回答をSSEで逐次受信
- 文単位でVOICEVOXを先行再生
- ブラウザ内でVRMを表示
- AIの感情値と簡易ボーンキーフレームを生成
- VRMの頭・胸・腕をブラウザ側で補間

つまり、

Browser
  ↓
FastAPI
  ├─ LLM
  ├─ VOICEVOX
  └─ motion/emotion
  ↓
Browser VRM + audio

という構造です。

## 起動

VOICEVOX Engineを起動したあと、Pythonで次を実行します。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python server.py
```

そして、

```
http://127.0.0.1:8000/
```

をブラウザで開きます。

初回のAI利用時には、既定のHugging Faceモデルが必要になります。

既定値:

```
rinna/japanese-gpt-neox-3.6b-instruction-sft
```

CUDA対応GPUがある環境ではCUDAを使用し、なければCPUを使います。

## 3D VRM

「VRMを開く」からVRMファイルを読み込めます。

このリポジトリにキャラクターVRM自体は入れていません。

VRMを読み込んだ後、AI応答に応じて簡易的なポーズを生成します。

ここでは「喜びアニメーション」「驚きアニメーション」などの固定アニメーション名を選ぶのではなく、AI側から返した数値キーフレームを補間する方式にしています。

## 次の実装

今の段階は「ブラウザでAIが話し、VRMがAI応答に反応する」土台です。

次に入れるべきものは、

- 全身IK
- 足IK
- 重心移動
- 視線
- 口パク
- VRM表情
- AI生成の連続モーション
- 必要なら歩行専用コントローラ

です。

VOICEVOXの利用条件と読み込むVRMの利用条件は、それぞれ確認してください。
