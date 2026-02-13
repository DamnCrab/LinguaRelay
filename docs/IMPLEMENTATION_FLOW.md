# 实施流程

## 阶段 1: 基线可运行

1. 初始化 `WXT + Vue + MV3`。
2. 接入 YouTube content script，完成直播检测与 overlay。
3. 打通 content/background 端口通信。

## 阶段 2: 运行时内核

1. 实现 `SessionManager`（并发、心跳、回收）。
2. 引入 `EnginePool`（引用计数 + 空闲卸载）。
3. 增加音频队列背压和丢包统计。

## 阶段 3: 在线 ASR + LLM 翻译

1. `GatewayWsAsrEngine` 支持 WebSocket 流式音频输入。
2. `OpenAICompatibleTranslator` 支持终稿/增量翻译。
3. 在 Popup/Options 暴露可配置 endpoint/model/key。

## 阶段 4: 兼容性与发布

1. Chromium 完整回归（Chrome/Edge）。
2. Firefox 适配（权限、注入与音频链路验证）。
3. Safari Web Extension 转换与功能降级测试。
4. 产物打包与多商店提审。

## 阶段 5: 后续增强建议

1. 落地 `local-onnx` worker（transformers.js + ONNX Runtime Web/WebGPU）。
2. 引入 VAD/端点检测，降低延迟和请求量。
3. 增加术语表、翻译缓存和句级稳定化策略。
4. 增加 e2e 自动化测试（Playwright + mocked gateway）。
