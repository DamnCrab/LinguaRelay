import type { SupportedUiLocale } from './i18n';
import type { StartupCheckIssue, StartupCheckIssueLevel } from './startup-checks';

interface StartupIssueCopy {
  title: string;
  guidance: string;
  includeRawDetail?: boolean;
}

export interface LocalizedStartupCheckIssue {
  code: string;
  level: StartupCheckIssueLevel;
  levelLabel: string;
  title: string;
  guidance: string;
  detail?: string;
}

const EN_LEVEL_LABELS: Record<StartupCheckIssueLevel, string> = {
  error: 'Error',
  warning: 'Warning',
};

const ZH_LEVEL_LABELS: Record<StartupCheckIssueLevel, string> = {
  error: '错误',
  warning: '警告',
};

const EN_ISSUE_COPY: Record<string, StartupIssueCopy> = {
  ASR_WS_URL_EMPTY: {
    title: 'ASR WebSocket URL is empty.',
    guidance:
      'Open the ASR tab, set a valid ws:// or wss:// URL, then save settings and start again.',
  },
  ASR_WS_URL_PROTOCOL: {
    title: 'ASR WebSocket URL protocol is not supported.',
    guidance: 'Use ws:// for local gateway or wss:// for remote gateway.',
  },
  ASR_WS_URL_INVALID: {
    title: 'ASR WebSocket URL format is invalid.',
    guidance: 'Check URL spelling and include full protocol and path.',
  },
  ASR_LOCAL_ENGINE_DISABLED: {
    title: 'Local ASR runtime is unavailable in this build.',
    guidance:
      'Switch ASR mode to online gateway, or use a build that includes local runtime worker/offscreen support.',
    includeRawDetail: true,
  },
  ASR_MODEL_ADAPTER_NOT_FOUND: {
    title: 'Selected local ASR model is unsupported.',
    guidance: 'Choose a supported model in ASR settings, then save and retry.',
    includeRawDetail: true,
  },
  ASR_RUNTIME_ENV_ERROR: {
    title: 'Current browser runtime cannot run this local model setup.',
    guidance:
      'Switch backend (WebGPU/WASM), ensure browser support, or change browser (Chromium recommended), then retry.',
    includeRawDetail: true,
  },
  ASR_RUNTIME_ENV_WARNING: {
    title: 'Local runtime may be unstable with current environment.',
    guidance: 'You can continue, but switching backend or browser is recommended for better stability.',
    includeRawDetail: true,
  },
  ASR_MODEL_NOT_READY: {
    title: 'Local ASR model is not ready.',
    guidance:
      'Open the Models tab, download the exact model+precision selected in ASR settings, and wait for status "ready".',
    includeRawDetail: true,
  },
  TRANSLATION_PROVIDER_INVALID: {
    title: 'Translation is enabled but provider is not configured.',
    guidance: 'Open the Translation tab and select a valid provider, or disable translation.',
  },
  TRANSLATION_ENDPOINT_EMPTY: {
    title: 'Translation endpoint is empty.',
    guidance: 'Fill in your provider endpoint URL in Translation settings.',
  },
  TRANSLATION_MODEL_EMPTY: {
    title: 'Translation model is empty.',
    guidance: 'Fill in the model name in Translation settings and save.',
  },
};

const ZH_ISSUE_COPY: Record<string, StartupIssueCopy> = {
  ASR_WS_URL_EMPTY: {
    title: 'ASR WebSocket 地址为空。',
    guidance: '请在 ASR 标签页填写有效的 ws:// 或 wss:// 地址，保存后再启动。',
  },
  ASR_WS_URL_PROTOCOL: {
    title: 'ASR WebSocket 协议不受支持。',
    guidance: '本地网关使用 ws://，远程网关使用 wss://。',
  },
  ASR_WS_URL_INVALID: {
    title: 'ASR WebSocket 地址格式无效。',
    guidance: '请检查地址拼写，并确保包含完整协议和路径。',
  },
  ASR_LOCAL_ENGINE_DISABLED: {
    title: '当前构建未启用本地 ASR 运行时。',
    guidance: '可切换为在线网关模式，或使用包含本地运行时能力的构建版本。',
    includeRawDetail: true,
  },
  ASR_MODEL_ADAPTER_NOT_FOUND: {
    title: '当前选择的本地 ASR 模型不受支持。',
    guidance: '请在 ASR 设置中改为支持的模型，保存后重试。',
    includeRawDetail: true,
  },
  ASR_RUNTIME_ENV_ERROR: {
    title: '当前浏览器环境无法运行该本地模型配置。',
    guidance: '请切换后端（WebGPU/WASM）、确认浏览器能力，或改用 Chromium 后重试。',
    includeRawDetail: true,
  },
  ASR_RUNTIME_ENV_WARNING: {
    title: '当前本地运行环境可能不稳定。',
    guidance: '可以继续尝试，但建议切换后端或浏览器以提升稳定性。',
    includeRawDetail: true,
  },
  ASR_MODEL_NOT_READY: {
    title: '本地 ASR 模型尚未就绪。',
    guidance: '请在模型标签页下载与 ASR 设置一致的模型和量化，等待状态变为 ready。',
    includeRawDetail: true,
  },
  TRANSLATION_PROVIDER_INVALID: {
    title: '已启用翻译，但未正确配置服务提供方。',
    guidance: '请在翻译标签页选择有效 provider，或关闭翻译。',
  },
  TRANSLATION_ENDPOINT_EMPTY: {
    title: '翻译接口地址为空。',
    guidance: '请在翻译设置中填写可用的 Endpoint 地址。',
  },
  TRANSLATION_MODEL_EMPTY: {
    title: '翻译模型名称为空。',
    guidance: '请在翻译设置中填写模型名称并保存。',
  },
};

const EN_UNKNOWN_COPY: StartupIssueCopy = {
  title: 'Startup check reported an unknown issue.',
  guidance: 'Check details below and adjust settings before starting again.',
  includeRawDetail: true,
};

const ZH_UNKNOWN_COPY: StartupIssueCopy = {
  title: '启动检查返回了未识别的问题。',
  guidance: '请查看下方技术细节并修正设置后再启动。',
  includeRawDetail: true,
};

export function localizeStartupCheckIssue(
  locale: SupportedUiLocale,
  issue: StartupCheckIssue,
): LocalizedStartupCheckIssue {
  const isZh = locale === 'zh-CN';
  const copyMap = isZh ? ZH_ISSUE_COPY : EN_ISSUE_COPY;
  const labels = isZh ? ZH_LEVEL_LABELS : EN_LEVEL_LABELS;
  const unknownCopy = isZh ? ZH_UNKNOWN_COPY : EN_UNKNOWN_COPY;
  const copy = copyMap[issue.code] ?? unknownCopy;
  const detail = copy.includeRawDetail ? issue.message : undefined;

  return {
    code: issue.code,
    level: issue.level,
    levelLabel: labels[issue.level],
    title: copy.title,
    guidance: copy.guidance,
    detail,
  };
}
