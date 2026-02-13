# 插件发布流程

## Chrome Web Store

1. `npm run build`。
2. 上传 `.output/chrome-mv3/` 或 zip 包。
3. 填写隐私与数据使用声明（音频处理、外部 API）。
4. 提审并处理审核反馈。

## Edge Add-ons

1. 复用 Chrome MV3 构建产物。
2. 在 Edge 开发者后台上传并填写同类隐私信息。

## Firefox AMO

1. 以 Firefox profile 构建并回归关键流程（音频捕获/端口通信）。
2. 在 AMO 提交包，核对权限与远程代码策略。

## Safari

1. 使用 Safari Web Extension 转换工具导入构建产物。
2. 在 Xcode 中签名、打包。
3. 通过 App Store Connect 提交审核。

## 发布前检查清单

1. 多直播并发会话稳定（至少 3 个 YouTube 标签页）。
2. 页面跳转/关闭后无残留会话与无持续 CPU 占用。
3. 模型切换后旧引擎可空闲卸载。
4. 异常网路下可恢复（WebSocket 断开后重连与错误提示）。
5. 敏感 key 不落日志，不暴露到页面上下文。
