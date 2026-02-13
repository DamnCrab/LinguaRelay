# 在线 ASR 网关协议（WebSocket）

插件默认通过 `asr.wsUrl` 连接网关，协议如下。

## 握手 URL Query

- `model`: 模型ID，例如 `whisper-large-v3-turbo`
- `language`: `auto|ja|en|...`
- `sourceUrl`: 页面 URL
- `apiKey`(可选): 透传给网关

## 客户端发送

1. `session-init` (JSON)

```json
{
  "type": "session-init",
  "stream": {
    "url": "https://www.youtube.com/watch?v=...",
    "title": "...",
    "isLive": true,
    "playbackRate": 1,
    "startedAt": 1730000000000
  },
  "endpointHeaders": {
    "x-tenant": "demo"
  }
}
```

2. `audio-meta` (JSON)

```json
{
  "type": "audio-meta",
  "sampleRate": 16000,
  "channels": 1,
  "sessionTimestampMs": 1730000000200
}
```

3. 原始二进制音频帧

- `ArrayBuffer`，PCM16 LE，单声道。

4. `playback-state` (JSON)

```json
{
  "type": "playback-state",
  "state": "playing"
}
```

## 网关回传

1. 增量字幕

```json
{
  "type": "partial",
  "text": "hello every",
  "startMs": 120,
  "endMs": 720,
  "language": "en",
  "revision": 3
}
```

2. 终稿字幕

```json
{
  "type": "final",
  "text": "hello everyone",
  "startMs": 120,
  "endMs": 940,
  "language": "en",
  "revision": 4
}
```

3. 统计信息

```json
{
  "type": "stats",
  "stats": {
    "reconnectCount": 1
  }
}
```

4. 错误

```json
{
  "type": "error",
  "code": "ASR_PROVIDER_ERROR",
  "message": "upstream timeout"
}
```

## 建议

- 网关侧统一 provider 输出，插件侧只实现一次协议。
- 对于 `whisper-large-v3-turbo + llm` 与 `whisper-large-v3-onnx`，仅切换 `model`。
