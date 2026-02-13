export const UI_LOCALE_AUTO = 'auto';
export const DEFAULT_UI_LOCALE = 'en';

export const SUPPORTED_UI_LOCALES = ['en', 'zh-CN'] as const;
export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number];
export type UiLocaleSetting = SupportedUiLocale | typeof UI_LOCALE_AUTO;

const EN_MESSAGES = {
  appTitle: 'LinguaRelay Live',
  appSubtitle: 'YouTube live transcription and translation',
  captureState: 'Capture',
  startCapture: 'Start',
  stopCapture: 'Stop',
  captureRunning: 'running',
  captureStopped: 'stopped',
  captureUnsupported: 'unsupported',
  startupChecks: 'Startup Checks',
  exportConfig: 'Export Config',
  importConfig: 'Import Config',
  interfaceSettings: 'Interface Settings',
  interfaceLanguage: 'Interface Language',
  languageAuto: 'Auto (Browser)',
  languageEnglish: 'English',
  languageChineseSimplified: 'Simplified Chinese',
  loading: 'Loading...',
  save: 'Save',
  refresh: 'Refresh',
  advanced: 'Advanced',
  revert: 'Revert',
  unsavedChanges: 'Unsaved changes',
  asrSettings: 'ASR Settings',
  tabGeneral: 'General',
  tabAsr: 'ASR',
  tabTranslation: 'Translation',
  tabModels: 'Models',
  tabRuntime: 'Runtime',
  mode: 'Mode',
  language: 'Language',
  websocketUrl: 'WebSocket URL',
  model: 'Model',
  apiKeyOptional: 'API Key (Optional)',
  apiKey: 'API Key',
  quantization: 'Quantization',
  backend: 'Backend',
  translationSettings: 'Translation Settings',
  enableTranslation: 'Enable Translation',
  provider: 'Provider',
  targetLanguage: 'Target Language',
  sourceLanguage: 'Source Language',
  endpoint: 'Endpoint',
  temperature: 'Temperature',
  modelCacheTitle: 'Model Cache (IndexedDB)',
  modelCacheDescription:
    'Download model variants from model adapters. Each adapter defines precision options, environment checks and status checks.',
  modelRankingHint:
    'Speed and quality scores are relative engineering estimates for quick comparison.',
  backendForDownload: 'Backend for Download',
  fileSize: 'File Size',
  speedScore: 'Speed',
  qualityScore: 'Quality',
  action: 'Action',
  modelAdapter: 'Model Adapter',
  precision: 'Precision',
  modelId: 'Model ID',
  source: 'Source',
  expectedFiles: 'Expected files',
  variantStatus: 'Variant status',
  warning: 'Warning',
  blocked: 'Blocked',
  download: 'Download',
  noCachedModels: 'No cached models.',
  files: 'files',
  inspectFiles: 'Inspect Files',
  cancel: 'Cancel',
  delete: 'Delete',
  runtimeCompatibility: 'Runtime and Compatibility',
  debugMode: 'Debug Mode',
  debugEnabledLabel: 'Enabled',
  enableDebug: 'Enable Debug',
  disableDebug: 'Disable Debug',
  refreshLogs: 'Refresh Logs',
  clearLogs: 'Clear Logs',
  debugHint: 'When enabled, capture/session/ASR events are recorded for diagnosis.',
  debugNoLogs: 'No debug logs yet.',
  browser: 'Browser',
  webgpu: 'WebGPU',
  wasm: 'WASM',
  audioWorklet: 'AudioWorklet',
  chromiumRecommendation:
    'Chromium is recommended for best extension API and audio capture stability.',
  sessions: 'Sessions',
  noActiveSessions: 'No active sessions.',
  dropped: 'dropped',
  tab: 'tab',
  frame: 'frame',
  valueTrue: 'true',
  valueFalse: 'false',
  optionsTitle: 'LinguaRelay Advanced Settings',
  onlineAsr: 'Online ASR',
  translationLlm: 'Translation LLM',
  modelHubSettings: 'Model Hub',
  huggingFaceTokenOptional: 'Hugging Face Token (Optional)',
  huggingFaceTokenHint: 'Used for model downloads when Hugging Face returns HTTP 401.',
  runtimeLimits: 'Runtime Limits',
  maxSessions: 'Max Sessions',
  engineIdleDisposeMs: 'Engine Idle Dispose (ms)',
  maxPendingAudioChunks: 'Max Pending Audio Chunks',
  partialTranslation: 'Translate Partial Subtitles',
  browserCompatibilityGuidance: 'Browser Compatibility Guidance',
  compatibilityHint:
    'Chromium: recommended for stable extension APIs and audio pipeline. Firefox/Safari: validate media capture and permission behavior before production publishing.',
  saveSettings: 'Save Settings',
  statusSettingsLoaded: 'Settings loaded',
  statusRefreshedRuntime: 'Runtime data refreshed',
  statusLoadFailed: 'Load failed: {message}',
  statusSaved: 'Saved',
  statusSaveFailed: 'Save failed: {message}',
  statusCaptureStarted: 'Overlay and capture started',
  statusCaptureStopped: 'Overlay and capture stopped',
  statusControlNoReceiver: 'No controllable media page in active tab',
  statusControlFailed: 'Control request failed: {message}',
  statusSaveBeforeStart: 'Please save settings before starting capture',
  statusStartupCheckFailed: 'Startup checks failed',
  statusExportedConfig: 'Configuration exported',
  statusImportedConfig: 'Configuration imported',
  statusExportFailed: 'Export failed: {message}',
  statusImportFailed: 'Import failed: {message}',
  statusNoChanges: 'No changes to save',
  statusValidationFailed: 'Please fix validation errors before saving',
  statusChangesReverted: 'Changes reverted',
  statusDownloadStarted: 'Download started for {modelId}',
  statusStartDownloadFailed: 'Start download failed: {message}',
  statusDeletedModel: 'Deleted model: {modelId}',
  statusDeleteFailed: 'Delete failed: {message}',
  statusCancelRequested: 'Cancel requested: {modelId}',
  statusCancelFailed: 'Cancel failed: {message}',
  statusDebugEnabled: 'Debug mode enabled',
  statusDebugDisabled: 'Debug mode disabled',
  statusDebugToggleFailed: 'Failed to toggle debug mode: {message}',
  statusDebugRefreshed: 'Debug logs refreshed',
  statusDebugRefreshFailed: 'Failed to refresh debug logs: {message}',
  statusDebugCleared: 'Debug logs cleared',
  statusDebugClearFailed: 'Failed to clear debug logs: {message}',
  variantStateNotDownloaded: 'not-downloaded',
  variantStateDownloading: 'downloading',
  variantStateReady: 'ready',
  variantStatePartial: 'partial',
  variantStateError: 'error',
} as const;

export type UiMessageKey = keyof typeof EN_MESSAGES;

const ZH_CN_MESSAGES: Record<UiMessageKey, string> = {
  appTitle: 'LinguaRelay 直播',
  appSubtitle: 'YouTube 直播实时转写与翻译',
  captureState: '采集',
  startCapture: '启动',
  stopCapture: '停止',
  captureRunning: '运行中',
  captureStopped: '已停止',
  captureUnsupported: '不支持',
  startupChecks: '启动检查',
  exportConfig: '导出配置',
  importConfig: '导入配置',
  interfaceSettings: '界面设置',
  interfaceLanguage: '界面语言',
  languageAuto: '自动（跟随浏览器）',
  languageEnglish: '英语',
  languageChineseSimplified: '简体中文',
  loading: '加载中...',
  save: '保存',
  refresh: '刷新',
  advanced: '高级',
  revert: '还原',
  unsavedChanges: '有未保存的更改',
  asrSettings: 'ASR 设置',
  tabGeneral: '通用',
  tabAsr: 'ASR',
  tabTranslation: '翻译',
  tabModels: '模型',
  tabRuntime: '运行时',
  mode: '模式',
  language: '语言',
  websocketUrl: 'WebSocket 地址',
  model: '模型',
  apiKeyOptional: 'API Key（可选）',
  apiKey: 'API Key',
  quantization: '量化',
  backend: '后端',
  translationSettings: '翻译设置',
  enableTranslation: '启用翻译',
  provider: '服务提供方',
  targetLanguage: '目标语言',
  sourceLanguage: '源语言',
  endpoint: '接口地址',
  temperature: '温度',
  modelCacheTitle: '模型缓存（IndexedDB）',
  modelCacheDescription:
    '可从模型适配器下载模型变体。每个适配器定义精度选项、环境检查和状态检查。',
  modelRankingHint: '速度和质量评分为工程估算值，用于快速对比模型变体。',
  backendForDownload: '下载后端',
  fileSize: '文件大小',
  speedScore: '速度',
  qualityScore: '质量',
  action: '操作',
  modelAdapter: '模型适配器',
  precision: '精度',
  modelId: '模型 ID',
  source: '来源',
  expectedFiles: '预期文件数',
  variantStatus: '变体状态',
  warning: '警告',
  blocked: '阻止',
  download: '下载',
  noCachedModels: '暂无缓存模型。',
  files: '文件',
  inspectFiles: '查看文件',
  cancel: '取消',
  delete: '删除',
  runtimeCompatibility: '运行时与兼容性',
  debugMode: '调试模式',
  debugEnabledLabel: '已启用',
  enableDebug: '开启调试',
  disableDebug: '关闭调试',
  refreshLogs: '刷新日志',
  clearLogs: '清空日志',
  debugHint: '开启后会记录采集、会话和 ASR 事件，便于定位问题。',
  debugNoLogs: '暂无调试日志。',
  browser: '浏览器',
  webgpu: 'WebGPU',
  wasm: 'WASM',
  audioWorklet: 'AudioWorklet',
  chromiumRecommendation: '建议优先使用 Chromium，以获得更稳定的扩展 API 和音频采集体验。',
  sessions: '会话',
  noActiveSessions: '暂无活跃会话。',
  dropped: '丢包',
  tab: '标签页',
  frame: '帧',
  valueTrue: '是',
  valueFalse: '否',
  optionsTitle: 'LinguaRelay 高级设置',
  onlineAsr: '在线 ASR',
  translationLlm: '翻译 LLM',
  modelHubSettings: '模型仓库',
  huggingFaceTokenOptional: 'Hugging Face Token（可选）',
  huggingFaceTokenHint: '当 Hugging Face 下载返回 HTTP 401 时会使用该 token。',
  runtimeLimits: '运行限制',
  maxSessions: '最大会话数',
  engineIdleDisposeMs: '引擎空闲释放（毫秒）',
  maxPendingAudioChunks: '最大待处理音频块',
  partialTranslation: '翻译中间字幕',
  browserCompatibilityGuidance: '浏览器兼容建议',
  compatibilityHint:
    'Chromium：推荐用于稳定扩展 API 与音频链路。Firefox/Safari：上线前请重点验证媒体采集与权限行为。',
  saveSettings: '保存设置',
  statusSettingsLoaded: '设置已加载',
  statusRefreshedRuntime: '运行时数据已刷新',
  statusLoadFailed: '加载失败：{message}',
  statusSaved: '保存成功',
  statusSaveFailed: '保存失败：{message}',
  statusCaptureStarted: '已启动悬浮窗与采集',
  statusCaptureStopped: '已停止悬浮窗与采集',
  statusControlNoReceiver: '当前标签页没有可控制的媒体页面',
  statusControlFailed: '控制请求失败：{message}',
  statusSaveBeforeStart: '请先保存设置再启动采集',
  statusStartupCheckFailed: '启动前检查未通过',
  statusExportedConfig: '配置已导出',
  statusImportedConfig: '配置已导入',
  statusExportFailed: '导出失败：{message}',
  statusImportFailed: '导入失败：{message}',
  statusNoChanges: '没有需要保存的更改',
  statusValidationFailed: '请先修复校验错误再保存',
  statusChangesReverted: '已还原更改',
  statusDownloadStarted: '已开始下载：{modelId}',
  statusStartDownloadFailed: '启动下载失败：{message}',
  statusDeletedModel: '已删除模型：{modelId}',
  statusDeleteFailed: '删除失败：{message}',
  statusCancelRequested: '已请求取消：{modelId}',
  statusCancelFailed: '取消失败：{message}',
  statusDebugEnabled: '已开启调试模式',
  statusDebugDisabled: '已关闭调试模式',
  statusDebugToggleFailed: '切换调试模式失败：{message}',
  statusDebugRefreshed: '调试日志已刷新',
  statusDebugRefreshFailed: '刷新调试日志失败：{message}',
  statusDebugCleared: '调试日志已清空',
  statusDebugClearFailed: '清空调试日志失败：{message}',
  variantStateNotDownloaded: '未下载',
  variantStateDownloading: '下载中',
  variantStateReady: '可用',
  variantStatePartial: '不完整',
  variantStateError: '错误',
};

const UI_MESSAGES: Record<SupportedUiLocale, Record<UiMessageKey, string>> = {
  en: EN_MESSAGES,
  'zh-CN': ZH_CN_MESSAGES,
};

export function getBrowserLocales(): string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }

  const locales = Array.isArray(navigator.languages) ? [...navigator.languages] : [];
  if (typeof navigator.language === 'string' && navigator.language.length > 0) {
    locales.push(navigator.language);
  }
  return locales;
}

export function resolveUiLocale(
  configuredLocale: string | undefined,
  browserLocales: readonly string[],
): SupportedUiLocale {
  if (configuredLocale && configuredLocale !== UI_LOCALE_AUTO) {
    return normalizeLocale(configuredLocale) ?? DEFAULT_UI_LOCALE;
  }

  for (const locale of browserLocales) {
    const normalized = normalizeLocale(locale);
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_UI_LOCALE;
}

export function translateUi(
  locale: SupportedUiLocale,
  key: UiMessageKey,
  params?: Record<string, string | number>,
): string {
  const template = UI_MESSAGES[locale][key] ?? UI_MESSAGES[DEFAULT_UI_LOCALE][key];
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = params[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}

function normalizeLocale(locale: string | undefined): SupportedUiLocale | null {
  if (!locale) {
    return null;
  }

  const lowered = locale.toLowerCase();
  if (lowered.startsWith('zh')) {
    return 'zh-CN';
  }
  if (lowered.startsWith('en')) {
    return 'en';
  }

  return null;
}
