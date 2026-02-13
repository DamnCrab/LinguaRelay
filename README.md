# LinguaRelay (Vue + WXT)

YouTube 直播实时转写与翻译浏览器插件，支持在线 ASR（WebSocket 网关协议）和可扩展引擎架构。

## 快速开始

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run zip
```

产物目录：`.output/chrome-mv3/`

本地联调 mock ASR 网关：

```bash
npm run gateway:mock
```

## 当前实现

- YouTube 直播检测与播放状态检测
- 内容脚本音频采集（WebAudio + ScriptProcessor）
- 后台多会话管理（每个 tab/frame 一个会话）
- 会话心跳超时回收与音频队列背压
- 引擎引用计数 + 空闲自动卸载
- 在线 ASR WebSocket 引擎（网关协议）
- LLM 翻译适配器（OpenAI-compatible）
- Vue Popup + Options 管理界面
- Popup 内模型下载与缓存（IndexedDB，支持进度、取消、删除）

## 目录

- `src/entrypoints/background.ts`: 后台服务 Worker
- `src/entrypoints/content.ts`: YouTube 内容脚本入口
- `src/content/youtube/`: 直播检测、音频采集、字幕 Overlay
- `src/background/session-manager.ts`: 会话并发、生命周期、引擎池
- `src/background/engines/`: ASR/翻译引擎适配层
- `docs/ARCHITECTURE.md`: 架构图
- `docs/IMPLEMENTATION_FLOW.md`: 实施流程
- `docs/PUBLISHING.md`: 多浏览器发布流程
- `docs/ASR_GATEWAY_PROTOCOL.md`: 在线 ASR 网关协议

## 注意

- `local-onnx` 在当前版本仅保留接口，未启用推理 Worker。
- 建议先通过 online-gateway 跑通端到端，再增量接入本地 ONNX/WebGPU。
- 当前模型下载采用“适配器插件模式”：每个模型一个 `*.adapter.ts`，在适配器内定义可选精度、环境检查、下载清单与下载状态检查。
