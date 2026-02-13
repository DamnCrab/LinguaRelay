<template>
  <div class="app" v-if="settings">
    <div class="topbar">
      <div>
        <h1>{{ t('appTitle') }}</h1>
        <div class="small">{{ t('appSubtitle') }}</div>
      </div>
      <div class="top-actions">
        <div class="status-chip" :class="`status-${statusTone}`">{{ status }}</div>
        <div class="capture-row">
          <span class="small">{{ t('captureState') }}: {{ captureStateLabel }}</span>
          <button class="secondary mini" @click="toggleCapture" :disabled="captureBusy || !captureSupported">
            {{ captureRunning ? t('stopCapture') : t('startCapture') }}
          </button>
        </div>
      </div>
    </div>

    <div class="tab-row">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <section class="card" v-if="validationErrors.length > 0">
      <div class="status">{{ t('blocked') }} ({{ validationErrors.length }})</div>
      <div
        class="small error-text"
        style="margin-top: 4px"
        v-for="issue in validationErrors"
        :key="`error:${issue.path}:${issue.message}`"
      >
        {{ issue.message }}
      </div>
    </section>

    <section class="card" v-if="validationWarnings.length > 0">
      <div class="status">{{ t('warning') }} ({{ validationWarnings.length }})</div>
      <div
        class="small"
        style="margin-top: 4px"
        v-for="issue in validationWarnings"
        :key="`warn:${issue.path}:${issue.message}`"
      >
        {{ issue.message }}
      </div>
    </section>

    <section class="card" v-if="startupIssues.length > 0">
      <div class="status">{{ t('startupChecks') }} ({{ startupIssues.length }})</div>
      <div
        class="small"
        :class="issue.level === 'error' ? 'error-text' : ''"
        style="margin-top: 4px"
        v-for="issue in startupIssues"
        :key="`${issue.code}:${issue.message}`"
      >
        [{{ issue.level }}] {{ issue.message }}
      </div>
    </section>

    <section class="card" v-if="activeTab === 'general'">
      <div class="status">{{ t('interfaceSettings') }}</div>
      <div class="grid" style="margin-top: 8px">
        <div>
          <label>{{ t('interfaceLanguage') }}</label>
          <select v-model="settings.ui.locale">
            <option value="auto">{{ t('languageAuto') }}</option>
            <option value="en">{{ t('languageEnglish') }}</option>
            <option value="zh-CN">{{ t('languageChineseSimplified') }}</option>
          </select>
        </div>
        <div>
          <label>{{ t('huggingFaceTokenOptional') }}</label>
          <input v-model.trim="settings.modelHub.huggingFaceToken" type="password" placeholder="hf_..." />
          <div class="small" style="margin-top: 3px">{{ t('huggingFaceTokenHint') }}</div>
        </div>
      </div>
      <div class="row" style="margin-top: 10px">
        <button class="secondary" @click="exportSettingsConfig">{{ t('exportConfig') }}</button>
        <button class="secondary" @click="openImportDialog">{{ t('importConfig') }}</button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          style="display: none"
          @change="onImportFileChanged"
        />
      </div>
    </section>

    <section class="card" v-if="activeTab === 'asr'">
      <div class="status">{{ t('asrSettings') }}</div>
      <div class="grid" style="margin-top: 8px">
        <div>
          <label>{{ t('mode') }}</label>
          <select v-model="settings.asr.mode" @change="onAsrModeChanged">
            <option value="online-gateway">online-gateway</option>
            <option value="local-onnx">local-onnx</option>
          </select>
        </div>

        <div>
          <label>{{ t('language') }}</label>
          <input v-model.trim="settings.asr.language" placeholder="auto / en / ja" />
        </div>
      </div>

      <template v-if="settings.asr.mode === 'online-gateway'">
        <div style="margin-top: 8px">
          <label>{{ t('websocketUrl') }}</label>
          <input v-model.trim="settings.asr.wsUrl" placeholder="ws://127.0.0.1:18080/v1/asr/stream" />
          <div class="small error-text" v-if="getFieldError('asr.wsUrl')">{{ getFieldError('asr.wsUrl') }}</div>
          <div class="small" v-else-if="getFieldWarning('asr.wsUrl')">{{ getFieldWarning('asr.wsUrl') }}</div>
        </div>
        <div class="grid" style="margin-top: 8px">
          <div>
            <label>{{ t('model') }}</label>
            <input v-model.trim="settings.asr.model" placeholder="whisper-large-v3-turbo" />
            <div class="small error-text" v-if="getFieldError('asr.model')">{{ getFieldError('asr.model') }}</div>
          </div>
          <div>
            <label>{{ t('apiKeyOptional') }}</label>
            <input v-model.trim="settings.asr.apiKey" type="password" />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="grid" style="margin-top: 8px">
          <div>
            <label>{{ t('model') }}</label>
            <select v-model="settings.asr.model">
              <option value="whisper-large-v3-turbo">whisper-large-v3-turbo</option>
              <option value="whisper-large-v3-onnx">whisper-large-v3-onnx</option>
            </select>
          </div>
          <div>
            <label>{{ t('quantization') }}</label>
            <select v-model="settings.asr.precision">
              <option value="q4f16">q4f16</option>
              <option value="q4">q4</option>
              <option value="fp16">fp16</option>
            </select>
          </div>
          <div>
            <label>{{ t('backend') }}</label>
            <select v-model="settings.asr.backend">
              <option value="webgpu">webgpu</option>
              <option value="wasm">wasm</option>
            </select>
          </div>
        </div>
      </template>
    </section>

    <section class="card" v-if="activeTab === 'translation'">
      <div class="status">{{ t('translationSettings') }}</div>
      <div class="grid" style="margin-top: 8px">
        <div>
          <label>{{ t('enableTranslation') }}</label>
          <select v-model="settings.translation.enabled">
            <option :value="true">{{ t('valueTrue') }}</option>
            <option :value="false">{{ t('valueFalse') }}</option>
          </select>
        </div>
        <div>
          <label>{{ t('provider') }}</label>
          <select v-model="settings.translation.provider" :disabled="!settings.translation.enabled">
            <option value="openai-compatible">openai-compatible</option>
            <option value="none">none</option>
          </select>
          <div class="small error-text" v-if="getFieldError('translation.provider')">
            {{ getFieldError('translation.provider') }}
          </div>
        </div>
      </div>

      <div class="grid" style="margin-top: 8px">
        <div>
          <label>{{ t('targetLanguage') }}</label>
          <input v-model.trim="settings.translation.targetLanguage" placeholder="zh-CN" />
          <div class="small error-text" v-if="getFieldError('translation.targetLanguage')">
            {{ getFieldError('translation.targetLanguage') }}
          </div>
          <div class="small" v-else-if="getFieldWarning('translation.targetLanguage')">
            {{ getFieldWarning('translation.targetLanguage') }}
          </div>
        </div>
        <div>
          <label>{{ t('sourceLanguage') }}</label>
          <input v-model.trim="settings.translation.sourceLanguage" placeholder="auto" />
        </div>
      </div>

      <template v-if="settings.translation.enabled && settings.translation.provider === 'openai-compatible'">
        <div style="margin-top: 8px">
          <label>{{ t('endpoint') }}</label>
          <input v-model.trim="settings.translation.endpoint" placeholder="https://api.openai.com/v1/chat/completions" />
          <div class="small error-text" v-if="getFieldError('translation.endpoint')">
            {{ getFieldError('translation.endpoint') }}
          </div>
        </div>
        <div class="grid" style="margin-top: 8px">
          <div>
            <label>{{ t('model') }}</label>
            <input v-model.trim="settings.translation.model" placeholder="gpt-5-mini" />
            <div class="small error-text" v-if="getFieldError('translation.model')">
              {{ getFieldError('translation.model') }}
            </div>
          </div>
          <div>
            <label>{{ t('apiKey') }}</label>
            <input v-model.trim="settings.translation.apiKey" type="password" />
            <div class="small" v-if="getFieldWarning('translation.apiKey')">{{ getFieldWarning('translation.apiKey') }}</div>
          </div>
          <div>
            <label>{{ t('temperature') }}</label>
            <input v-model.number="settings.translation.temperature" type="number" min="0" max="2" step="0.1" />
          </div>
        </div>
      </template>
    </section>

    <section class="card" v-if="activeTab === 'models'">
      <div class="status">{{ t('modelCacheTitle') }}</div>
      <div class="small" style="margin-top: 4px">{{ t('modelCacheDescription') }}</div>
      <div class="small" style="margin-top: 4px">{{ t('modelRankingHint') }}</div>

      <div class="table-toolbar">
        <div>
          <label>{{ t('backendForDownload') }}</label>
          <select v-model="selectedModelBackend">
            <option value="webgpu">webgpu</option>
            <option value="wasm">wasm</option>
          </select>
        </div>
      </div>

      <div class="table-wrap">
        <table class="model-table">
          <thead>
            <tr>
              <th>{{ t('model') }}</th>
              <th>{{ t('quantization') }}</th>
              <th>{{ t('fileSize') }}</th>
              <th>{{ t('speedScore') }}</th>
              <th>{{ t('qualityScore') }}</th>
              <th>{{ t('variantStatus') }}</th>
              <th>{{ t('action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in modelVariantRows" :key="row.modelId" :class="{ blocked: !row.envCheck.ok }">
              <td>{{ row.adapterTitle }}</td>
              <td>{{ row.precisionLabel }}</td>
              <td>{{ formatBytes(row.estimatedSizeBytes) }}</td>
              <td>{{ row.speedScore.toFixed(1) }}/10</td>
              <td>{{ row.qualityScore.toFixed(1) }}/10</td>
              <td>
                <span class="badge">{{ formatVariantState(row.status.state) }}</span>
                <div class="small" v-if="row.status.state === 'downloading'">
                  {{ row.status.progressPercent.toFixed(1) }}%
                </div>
                <div class="small error-text" v-if="row.summary?.errorMessage">{{ row.summary.errorMessage }}</div>
                <div class="small error-text" v-if="row.envCheck.errors.length > 0">
                  {{ row.envCheck.errors.join(' | ') }}
                </div>
              </td>
              <td>
                <div class="row compact">
                  <button
                    class="primary"
                    @click="downloadVariant(row)"
                    :disabled="!row.envCheck.ok || row.summary?.state === 'downloading'"
                  >
                    {{ t('download') }}
                  </button>
                  <button
                    class="secondary"
                    @click="cancelDownload(row.modelId)"
                    v-if="row.summary?.state === 'downloading'"
                  >
                    {{ t('cancel') }}
                  </button>
                  <button
                    class="secondary"
                    @click="removeModel(row.modelId)"
                    :disabled="!row.summary"
                  >
                    {{ t('delete') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" v-if="activeTab === 'runtime'">
      <div class="status">{{ t('runtimeCompatibility') }}</div>
      <div class="small" style="margin-top: 4px">
        {{ t('browser') }}: {{ runtimeInfo?.browser ?? '-' }} |
        {{ t('webgpu') }}: {{ runtimeInfo?.support.webgpu ?? false }} |
        {{ t('wasm') }}: {{ runtimeInfo?.support.wasm ?? false }} |
        {{ t('audioWorklet') }}: {{ runtimeInfo?.support.audioWorklet ?? false }}
      </div>
      <div class="small" style="margin-top: 4px">
        {{ t('chromiumRecommendation') }}
      </div>

      <div class="status" style="margin-top: 10px">{{ t('debugMode') }}</div>
      <div class="row compact" style="margin-top: 6px">
        <span class="small">{{ t('debugEnabledLabel') }}: {{ debugEnabled ? t('valueTrue') : t('valueFalse') }}</span>
        <button class="secondary mini" @click="toggleDebug" :disabled="debugBusy">
          {{ debugEnabled ? t('disableDebug') : t('enableDebug') }}
        </button>
        <button class="secondary mini" @click="refreshDebugEvents" :disabled="debugBusy || !debugEnabled">
          {{ t('refreshLogs') }}
        </button>
        <button class="secondary mini" @click="clearDebug" :disabled="debugBusy || !debugEnabled">
          {{ t('clearLogs') }}
        </button>
      </div>
      <div class="small" style="margin-top: 4px">{{ t('debugHint') }}</div>

      <div class="debug-log" v-if="debugEnabled">
        <div v-if="debugEvents.length === 0" class="small">{{ t('debugNoLogs') }}</div>
        <div v-for="event in debugEvents" :key="event.id" class="debug-row">
          <div class="small">
            <span class="badge">{{ event.level }}</span>
            {{ formatDebugTime(event.timestamp) }} | {{ event.source }} | {{ event.scope }}
          </div>
          <div class="small">{{ event.message }}</div>
          <div class="small" v-if="event.details">{{ event.details }}</div>
        </div>
      </div>

      <div class="status" style="margin-top: 10px">{{ t('sessions') }}</div>
      <div v-if="sessions.length === 0" class="small" style="margin-top: 6px">{{ t('noActiveSessions') }}</div>
      <div v-for="session in sessions" :key="session.sessionId" class="session">
        <div>
          <span class="badge">{{ session.state }}</span>
          <span class="small"> {{ t('tab') }}={{ session.tabId }} {{ t('frame') }}={{ session.frameId }}</span>
        </div>
        <div class="small" style="margin-top: 4px">{{ session.asrEngine }}</div>
        <div class="small">{{ t('dropped') }}={{ session.droppedAudioChunks }}</div>
      </div>
    </section>

    <div class="row footer-actions">
      <button class="primary" @click="save" :disabled="!canSave">{{ t('save') }}</button>
      <button class="secondary" @click="revertChanges" :disabled="!isDirty">{{ t('revert') }}</button>
      <button class="secondary" @click="refresh(false)" :disabled="isSaving">{{ t('refresh') }}</button>
      <button class="secondary" @click="openOptions">{{ t('advanced') }}</button>
      <span class="small" v-if="isDirty">{{ t('unsavedChanges') }}</span>
    </div>
  </div>

  <div v-else class="app">{{ t('loading') }}</div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import type { AsrMode, SessionRuntimeStatus, UserSettings } from '../../shared/contracts';
import type { DebugEventRecord } from '../../shared/debug-events';
import {
  CONTENT_CONTROL_MESSAGE_TYPE,
  type ContentControlAction,
  type ContentControlRequestMessage,
  type ContentControlResponseMessage,
} from '../../shared/content-control';
import type { CachedModelSummary } from '../../shared/model-cache';
import type { StartupCheckIssue } from '../../shared/startup-checks';
import {
  getBrowserLocales,
  resolveUiLocale,
  translateUi,
  type UiMessageKey,
} from '../../shared/i18n';
import { listModelAdapters } from '../../shared/model-adapters';
import type {
  ModelEnvironmentCheckResult,
  ModelEnvironmentContext,
  ModelRuntimeBackendId,
  ModelVariantDownloadStatus,
} from '../../shared/model-adapters/contracts';
import {
  settingsFingerprint,
  switchAsrMode,
  validateUserSettings,
} from '../../shared/settings-form';
import {
  clearDebugEvents,
  getDebugState,
  listDebugEvents,
  cancelModelDownload,
  deleteModel,
  downloadModelVariant,
  getRuntimeInfo,
  listModelCache,
  listSessions,
  loadSettings,
  setDebugState,
  runStartupChecks,
  saveSettings,
} from '../../shared/runtime-api';

type SettingsTab = 'general' | 'asr' | 'translation' | 'models' | 'runtime';

interface ModelVariantTableRow {
  adapterId: string;
  adapterTitle: string;
  precisionId: string;
  precisionLabel: string;
  estimatedSizeBytes: number;
  speedScore: number;
  qualityScore: number;
  modelId: string;
  summary?: CachedModelSummary;
  status: ModelVariantDownloadStatus;
  envCheck: ModelEnvironmentCheckResult;
}

const settings = ref<UserSettings | null>(null);
const savedSettingsSnapshot = ref<UserSettings | null>(null);
const sessions = ref<SessionRuntimeStatus[]>([]);
const runtimeInfo = ref<Awaited<ReturnType<typeof getRuntimeInfo>> | null>(null);
const modelCache = ref<CachedModelSummary[]>([]);
const status = ref('');
const statusTone = ref<'neutral' | 'success' | 'error'>('neutral');
const isSaving = ref(false);
const activeTab = ref<SettingsTab>('general');
const selectedModelBackend = ref<ModelRuntimeBackendId>('webgpu');
const captureRunning = ref(false);
const captureSupported = ref(true);
const captureBusy = ref(false);
const startupIssues = ref<StartupCheckIssue[]>([]);
const importInput = ref<HTMLInputElement | null>(null);
const debugEnabled = ref(false);
const debugEvents = ref<DebugEventRecord[]>([]);
const debugBusy = ref(false);

const browserLocales = getBrowserLocales();
const uiLocale = computed(() => resolveUiLocale(settings.value?.ui?.locale, browserLocales));
const t = (key: UiMessageKey, params?: Record<string, string | number>): string =>
  translateUi(uiLocale.value, key, params);

const tabs = computed(() => [
  { id: 'general' as const, label: t('tabGeneral') },
  { id: 'asr' as const, label: t('tabAsr') },
  { id: 'translation' as const, label: t('tabTranslation') },
  { id: 'models' as const, label: t('tabModels') },
  { id: 'runtime' as const, label: t('tabRuntime') },
]);

const validation = computed(() => (settings.value ? validateUserSettings(settings.value) : null));
const validationErrors = computed(() => validation.value?.errors ?? []);
const validationWarnings = computed(() => validation.value?.warnings ?? []);
const isDirty = computed(() => {
  if (!settings.value || !savedSettingsSnapshot.value) {
    return false;
  }
  return settingsFingerprint(settings.value) !== settingsFingerprint(savedSettingsSnapshot.value);
});
const canSave = computed(
  () => Boolean(settings.value) && isDirty.value && Boolean(validation.value?.valid) && !isSaving.value,
);
const captureStateLabel = computed(() => {
  if (!captureSupported.value) {
    return t('captureUnsupported');
  }
  return captureRunning.value ? t('captureRunning') : t('captureStopped');
});

const modelVariantRows = computed<ModelVariantTableRow[]>(() => {
  const adapters = listModelAdapters();
  const summaryById = new Map(modelCache.value.map((item) => [item.modelId, item]));
  const fallback: ModelEnvironmentContext = {
    browser: 'Unknown',
    support: {
      webgpu: false,
      wasm: false,
      sharedWorker: false,
      audioWorklet: false,
    },
  };
  const context = runtimeInfo.value ?? fallback;

  return adapters.flatMap((adapter) =>
    adapter.precisions.map((precision) => {
      const modelId = adapter.getModelId(precision.id);
      const summary = summaryById.get(modelId);
      const status = adapter.getDownloadStatus({
        precisionId: precision.id,
        summary,
      });
      const envCheck = adapter.checkEnvironment(context, {
        precisionId: precision.id,
        backendId: selectedModelBackend.value,
      });
      const score = getVariantScore(adapter.id, precision.id);
      return {
        adapterId: adapter.id,
        adapterTitle: adapter.title,
        precisionId: precision.id,
        precisionLabel: precision.label,
        estimatedSizeBytes: precision.estimatedSizeBytes,
        speedScore: score.speed,
        qualityScore: score.quality,
        modelId,
        summary,
        status,
        envCheck,
      };
    }),
  );
});

let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await refresh(true);
  await refreshCaptureStatus();
  refreshTimer = setInterval(() => {
    void refreshFast();
  }, 2000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

function getFieldError(...paths: string[]): string {
  const map = validation.value?.errorMap ?? {};
  for (const path of paths) {
    if (map[path]) {
      return map[path];
    }
  }
  return '';
}

function getFieldWarning(...paths: string[]): string {
  const map = validation.value?.warningMap ?? {};
  for (const path of paths) {
    if (map[path]) {
      return map[path];
    }
  }
  return '';
}

function onAsrModeChanged(event: Event): void {
  if (!settings.value) {
    return;
  }
  const nextMode = (event.target as HTMLSelectElement).value as AsrMode;
  settings.value.asr = switchAsrMode(settings.value.asr, nextMode);
}

function setStatus(tone: 'neutral' | 'success' | 'error', message: string): void {
  statusTone.value = tone;
  status.value = message;
}

function exportSettingsConfig(): void {
  if (!settings.value) {
    return;
  }

  try {
    const payload = {
      schema: 'linguarelay-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings.value,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linguarelay-settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus('success', t('statusExportedConfig'));
  } catch (error) {
    setStatus(
      'error',
      t('statusExportFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

function openImportDialog(): void {
  importInput.value?.click();
}

async function onImportFileChanged(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }

  try {
    const rawText = await file.text();
    const parsed = JSON.parse(rawText) as unknown;
    const candidate =
      typeof parsed === 'object' && parsed !== null && 'settings' in parsed
        ? (parsed as { settings: unknown }).settings
        : parsed;
    const validated = validateUserSettings(candidate as UserSettings);
    if (!validated.valid) {
      throw new Error(validated.errors.map((item) => item.message).join(' | '));
    }

    await saveSettings(validated.normalized);
    settings.value = structuredClone(validated.normalized);
    savedSettingsSnapshot.value = structuredClone(validated.normalized);
    startupIssues.value = [];
    await refreshCaptureStatus();
    setStatus('success', t('statusImportedConfig'));
  } catch (error) {
    setStatus(
      'error',
      t('statusImportFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

async function toggleCapture(): Promise<void> {
  if (captureBusy.value) {
    return;
  }

  captureBusy.value = true;
  try {
    const action: ContentControlAction = captureRunning.value ? 'stop' : 'start';
    if (action === 'start') {
      if (isDirty.value) {
        setStatus('error', t('statusSaveBeforeStart'));
        return;
      }

      const check = await runStartupChecks();
      startupIssues.value = check.issues;
      if (!check.ok) {
        setStatus('error', t('statusStartupCheckFailed'));
        return;
      }
    } else {
      startupIssues.value = [];
    }

    const response = await sendContentControl(action);
    if (!response.ok) {
      if (!captureSupported.value) {
        setStatus('error', t('statusControlNoReceiver'));
      } else {
        setStatus(
          'error',
          t('statusControlFailed', {
            message: response.message ?? 'unknown',
          }),
        );
      }
      return;
    }

    captureRunning.value = response.running;
    setStatus('success', response.running ? t('statusCaptureStarted') : t('statusCaptureStopped'));
  } finally {
    captureBusy.value = false;
  }
}

async function refreshCaptureStatus(): Promise<void> {
  const response = await sendContentControl('status');
  if (!response.ok) {
    return;
  }

  captureRunning.value = response.running;
}

async function sendContentControl(action: ContentControlAction): Promise<ContentControlResponseMessage> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    captureSupported.value = false;
    captureRunning.value = false;
    return {
      ok: false,
      running: false,
      message: 'active tab not found',
    };
  }

  try {
    const request: ContentControlRequestMessage = {
      type: CONTENT_CONTROL_MESSAGE_TYPE,
      action,
    };
    const response = await chrome.tabs.sendMessage(tab.id, request) as ContentControlResponseMessage;
    if (!response || typeof response !== 'object') {
      captureSupported.value = false;
      captureRunning.value = false;
      return {
        ok: false,
        running: false,
        message: 'empty response',
      };
    }

    captureSupported.value = true;
    captureRunning.value = Boolean(response.running);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown content control error';
    const noReceiver = /Receiving end does not exist|Could not establish connection/i.test(message);
    captureSupported.value = !noReceiver;
    captureRunning.value = false;
    return {
      ok: false,
      running: false,
      message,
    };
  }
}

async function refresh(forceReloadSettings: boolean): Promise<void> {
  try {
    if (forceReloadSettings || !settings.value || !isDirty.value) {
      const [loadedSettings, loadedSessions, info, modelRows, dbgState] = await Promise.all([
        loadSettings(),
        listSessions(),
        getRuntimeInfo(),
        listModelCache(),
        getDebugState(),
      ]);
      const normalizedSettings = validateUserSettings(loadedSettings).normalized;
      settings.value = structuredClone(normalizedSettings);
      savedSettingsSnapshot.value = structuredClone(normalizedSettings);
      sessions.value = loadedSessions;
      runtimeInfo.value = info;
      modelCache.value = modelRows;
      debugEnabled.value = dbgState.enabled;
      if (dbgState.enabled) {
        debugEvents.value = await listDebugEvents(250);
      } else {
        debugEvents.value = [];
      }
      if (!info.support.webgpu) {
        selectedModelBackend.value = 'wasm';
      }
      await refreshCaptureStatus();
      setStatus('neutral', t('statusSettingsLoaded'));
      return;
    }

    const [loadedSessions, info, modelRows, dbgState] = await Promise.all([
      listSessions(),
      getRuntimeInfo(),
      listModelCache(),
      getDebugState(),
    ]);
    sessions.value = loadedSessions;
    runtimeInfo.value = info;
    modelCache.value = modelRows;
    debugEnabled.value = dbgState.enabled;
    if (dbgState.enabled) {
      debugEvents.value = await listDebugEvents(250);
    } else {
      debugEvents.value = [];
    }
    await refreshCaptureStatus();
    setStatus('neutral', t('statusRefreshedRuntime'));
  } catch (error) {
    setStatus(
      'error',
      t('statusLoadFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

async function refreshFast(): Promise<void> {
  try {
    const [loadedSessions, modelRows, dbgState] = await Promise.all([
      listSessions(),
      listModelCache(),
      getDebugState(),
    ]);
    sessions.value = loadedSessions;
    modelCache.value = modelRows;
    debugEnabled.value = dbgState.enabled;
    if (dbgState.enabled) {
      debugEvents.value = await listDebugEvents(120);
    } else if (debugEvents.value.length > 0) {
      debugEvents.value = [];
    }
    await refreshCaptureStatus();
  } catch {
    // Silent failure for polling refresh.
  }
}

async function save(): Promise<void> {
  if (!settings.value || !validation.value) {
    return;
  }

  if (!isDirty.value) {
    setStatus('neutral', t('statusNoChanges'));
    return;
  }

  if (!validation.value.valid) {
    setStatus('error', t('statusValidationFailed'));
    return;
  }

  isSaving.value = true;

  try {
    await saveSettings(validation.value.normalized);
    settings.value = structuredClone(validation.value.normalized);
    savedSettingsSnapshot.value = structuredClone(validation.value.normalized);
    setStatus('success', t('statusSaved'));
  } catch (error) {
    setStatus(
      'error',
      t('statusSaveFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  } finally {
    isSaving.value = false;
  }
}

function revertChanges(): void {
  if (!savedSettingsSnapshot.value) {
    return;
  }
  settings.value = structuredClone(savedSettingsSnapshot.value);
  setStatus('neutral', t('statusChangesReverted'));
}

async function downloadVariant(row: ModelVariantTableRow): Promise<void> {
  try {
    await downloadModelVariant({
      adapterId: row.adapterId,
      precisionId: row.precisionId,
      backendId: selectedModelBackend.value,
    });
    setStatus(
      'success',
      t('statusDownloadStarted', {
        modelId: row.modelId,
      }),
    );
    await refreshFast();
  } catch (error) {
    setStatus(
      'error',
      t('statusStartDownloadFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

async function removeModel(modelId: string): Promise<void> {
  try {
    await deleteModel(modelId);
    await refreshFast();
    setStatus('success', t('statusDeletedModel', { modelId }));
  } catch (error) {
    setStatus(
      'error',
      t('statusDeleteFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

async function cancelDownload(modelId: string): Promise<void> {
  try {
    await cancelModelDownload(modelId);
    setStatus('neutral', t('statusCancelRequested', { modelId }));
    await refreshFast();
  } catch (error) {
    setStatus(
      'error',
      t('statusCancelFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

async function toggleDebug(): Promise<void> {
  if (debugBusy.value) {
    return;
  }
  debugBusy.value = true;
  try {
    const next = !debugEnabled.value;
    const state = await setDebugState(next);
    debugEnabled.value = state.enabled;
    if (state.enabled) {
      debugEvents.value = await listDebugEvents(250);
      setStatus('success', t('statusDebugEnabled'));
    } else {
      debugEvents.value = [];
      setStatus('neutral', t('statusDebugDisabled'));
    }
  } catch (error) {
    setStatus(
      'error',
      t('statusDebugToggleFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  } finally {
    debugBusy.value = false;
  }
}

async function refreshDebugEvents(): Promise<void> {
  if (debugBusy.value || !debugEnabled.value) {
    return;
  }
  debugBusy.value = true;
  try {
    debugEvents.value = await listDebugEvents(250);
    setStatus('neutral', t('statusDebugRefreshed'));
  } catch (error) {
    setStatus(
      'error',
      t('statusDebugRefreshFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  } finally {
    debugBusy.value = false;
  }
}

async function clearDebug(): Promise<void> {
  if (debugBusy.value || !debugEnabled.value) {
    return;
  }
  debugBusy.value = true;
  try {
    await clearDebugEvents();
    debugEvents.value = [];
    setStatus('success', t('statusDebugCleared'));
  } catch (error) {
    setStatus(
      'error',
      t('statusDebugClearFailed', {
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  } finally {
    debugBusy.value = false;
  }
}

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}

function formatVariantState(state: string): string {
  switch (state) {
    case 'not-downloaded':
      return t('variantStateNotDownloaded');
    case 'downloading':
      return t('variantStateDownloading');
    case 'ready':
      return t('variantStateReady');
    case 'partial':
      return t('variantStatePartial');
    case 'error':
      return t('variantStateError');
    default:
      return state;
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }

  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getVariantScore(adapterId: string, precisionId: string): { speed: number; quality: number } {
  const speedBase =
    precisionId === 'q4' ? 9.1 : precisionId === 'q4f16' ? 7.4 : precisionId === 'fp16' ? 5.2 : 7.0;
  const qualityBase =
    precisionId === 'fp16' ? 9.8 : precisionId === 'q4f16' ? 8.6 : precisionId === 'q4' ? 7.3 : 8.0;

  const speedBias = adapterId === 'whisper-large-v3-turbo' ? 0.7 : -0.5;
  const qualityBias = adapterId === 'whisper-large-v3' ? 0.5 : 0;

  return {
    speed: clampScore(speedBase + speedBias),
    quality: clampScore(qualityBase + qualityBias),
  };
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(10, value));
}

function formatDebugTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}
</script>
