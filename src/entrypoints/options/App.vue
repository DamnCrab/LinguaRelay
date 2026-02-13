<template>
  <main class="container" v-if="settings">
    <h1>{{ t('optionsTitle') }}</h1>

    <div class="status-row">
      <span class="tip" :class="`tip-${statusTone}`">{{ status }}</span>
      <span class="tip" v-if="isDirty">{{ t('unsavedChanges') }}</span>
    </div>

    <section class="panel" v-if="validationErrors.length > 0">
      <h3>{{ t('blocked') }} ({{ validationErrors.length }})</h3>
      <div
        class="tip tip-error"
        v-for="issue in validationErrors"
        :key="`error:${issue.path}:${issue.message}`"
      >
        {{ issue.message }}
      </div>
    </section>

    <section class="panel" v-if="validationWarnings.length > 0">
      <h3>{{ t('warning') }} ({{ validationWarnings.length }})</h3>
      <div
        class="tip"
        v-for="issue in validationWarnings"
        :key="`warn:${issue.path}:${issue.message}`"
      >
        {{ issue.message }}
      </div>
    </section>

    <section class="panel">
      <h3>{{ t('interfaceSettings') }}</h3>
      <div class="grid">
        <div>
          <label>{{ t('interfaceLanguage') }}</label>
          <select v-model="settings.ui.locale">
            <option value="auto">{{ t('languageAuto') }}</option>
            <option value="en">{{ t('languageEnglish') }}</option>
            <option value="zh-CN">{{ t('languageChineseSimplified') }}</option>
          </select>
        </div>
      </div>
    </section>

    <section class="panel">
      <h3>{{ t('modelHubSettings') }}</h3>
      <div class="grid">
        <div>
          <label>{{ t('huggingFaceTokenOptional') }}</label>
          <input v-model.trim="settings.modelHub.huggingFaceToken" type="password" placeholder="hf_..." />
          <div class="tip">{{ t('huggingFaceTokenHint') }}</div>
        </div>
      </div>
    </section>

    <section class="panel">
      <h3>{{ t('onlineAsr') }}</h3>
      <div class="grid">
        <div>
          <label>{{ t('mode') }}</label>
          <select v-model="settings.asr.mode" @change="onAsrModeChanged">
            <option value="online-gateway">online-gateway</option>
            <option value="local-onnx">local-onnx</option>
          </select>
        </div>
        <div>
          <label>{{ t('language') }}</label>
          <input v-model.trim="settings.asr.language" placeholder="auto / ja / en" />
        </div>
      </div>

      <div v-if="settings.asr.mode === 'online-gateway'" class="grid" style="margin-top: 12px">
        <div>
          <label>{{ t('websocketUrl') }}</label>
          <input v-model.trim="settings.asr.wsUrl" />
          <div class="tip tip-error" v-if="getFieldError('asr.wsUrl')">{{ getFieldError('asr.wsUrl') }}</div>
          <div class="tip" v-else-if="getFieldWarning('asr.wsUrl')">{{ getFieldWarning('asr.wsUrl') }}</div>
        </div>
        <div>
          <label>{{ t('model') }}</label>
          <input v-model.trim="settings.asr.model" />
          <div class="tip tip-error" v-if="getFieldError('asr.model')">{{ getFieldError('asr.model') }}</div>
        </div>
        <div>
          <label>{{ t('apiKey') }}</label>
          <input v-model.trim="settings.asr.apiKey" type="password" />
        </div>
      </div>

      <div v-else class="grid" style="margin-top: 12px">
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
    </section>

    <section class="panel">
      <h3>{{ t('translationLlm') }}</h3>
      <div class="grid">
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
          <div class="tip tip-error" v-if="getFieldError('translation.provider')">
            {{ getFieldError('translation.provider') }}
          </div>
        </div>
        <div>
          <label>{{ t('targetLanguage') }}</label>
          <input v-model.trim="settings.translation.targetLanguage" />
          <div class="tip tip-error" v-if="getFieldError('translation.targetLanguage')">
            {{ getFieldError('translation.targetLanguage') }}
          </div>
          <div class="tip" v-else-if="getFieldWarning('translation.targetLanguage')">
            {{ getFieldWarning('translation.targetLanguage') }}
          </div>
        </div>
        <div>
          <label>{{ t('sourceLanguage') }}</label>
          <input v-model.trim="settings.translation.sourceLanguage" />
        </div>

        <template v-if="settings.translation.enabled && settings.translation.provider === 'openai-compatible'">
          <div>
            <label>{{ t('endpoint') }}</label>
            <input v-model.trim="settings.translation.endpoint" />
            <div class="tip tip-error" v-if="getFieldError('translation.endpoint')">
              {{ getFieldError('translation.endpoint') }}
            </div>
          </div>
          <div>
            <label>{{ t('model') }}</label>
            <input v-model.trim="settings.translation.model" />
            <div class="tip tip-error" v-if="getFieldError('translation.model')">
              {{ getFieldError('translation.model') }}
            </div>
          </div>
          <div>
            <label>{{ t('apiKey') }}</label>
            <input v-model.trim="settings.translation.apiKey" type="password" />
            <div class="tip" v-if="getFieldWarning('translation.apiKey')">
              {{ getFieldWarning('translation.apiKey') }}
            </div>
          </div>
        </template>

        <div>
          <label>{{ t('temperature') }}</label>
          <input v-model.number="settings.translation.temperature" type="number" min="0" max="2" step="0.1" />
        </div>
      </div>
    </section>

    <section class="panel">
      <h3>{{ t('runtimeLimits') }}</h3>
      <div class="grid">
        <div>
          <label>{{ t('maxSessions') }}</label>
          <input v-model.number="settings.runtime.maxSessions" type="number" min="1" max="12" />
        </div>
        <div>
          <label>{{ t('engineIdleDisposeMs') }}</label>
          <input v-model.number="settings.runtime.engineIdleDisposeMs" type="number" min="10000" max="300000" />
        </div>
        <div>
          <label>{{ t('maxPendingAudioChunks') }}</label>
          <input v-model.number="settings.runtime.maxPendingAudioChunks" type="number" min="4" max="128" />
        </div>
        <div>
          <label>{{ t('partialTranslation') }}</label>
          <select v-model="settings.runtime.partialTranslation">
            <option :value="true">{{ t('valueTrue') }}</option>
            <option :value="false">{{ t('valueFalse') }}</option>
          </select>
        </div>
      </div>
    </section>

    <section class="panel">
      <h3>{{ t('browserCompatibilityGuidance') }}</h3>
      <div class="tip">{{ t('compatibilityHint') }}</div>
    </section>

    <div class="actions">
      <button @click="save" :disabled="!canSave">{{ t('saveSettings') }}</button>
      <button class="secondary" @click="revertChanges" :disabled="!isDirty">{{ t('revert') }}</button>
      <button class="secondary" @click="reloadSettings" :disabled="isSaving">{{ t('refresh') }}</button>
    </div>
  </main>

  <main v-else class="container">{{ t('loading') }}</main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { AsrMode, UserSettings } from '../../shared/contracts';
import {
  getBrowserLocales,
  resolveUiLocale,
  translateUi,
  type UiMessageKey,
} from '../../shared/i18n';
import {
  settingsFingerprint,
  switchAsrMode,
  validateUserSettings,
} from '../../shared/settings-form';
import { loadSettings, saveSettings } from '../../shared/runtime-api';

const settings = ref<UserSettings | null>(null);
const savedSettingsSnapshot = ref<UserSettings | null>(null);
const status = ref('');
const statusTone = ref<'neutral' | 'success' | 'error'>('neutral');
const isSaving = ref(false);

const browserLocales = getBrowserLocales();
const uiLocale = computed(() => resolveUiLocale(settings.value?.ui?.locale, browserLocales));
const t = (key: UiMessageKey, params?: Record<string, string | number>): string =>
  translateUi(uiLocale.value, key, params);

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

onMounted(async () => {
  await reloadSettings();
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

async function save(): Promise<void> {
  if (!settings.value || !validation.value) {
    return;
  }

  if (!isDirty.value) {
    statusTone.value = 'neutral';
    status.value = t('statusNoChanges');
    return;
  }

  if (!validation.value.valid) {
    statusTone.value = 'error';
    status.value = t('statusValidationFailed');
    return;
  }

  isSaving.value = true;

  try {
    await saveSettings(validation.value.normalized);
    settings.value = structuredClone(validation.value.normalized);
    savedSettingsSnapshot.value = structuredClone(validation.value.normalized);
    statusTone.value = 'success';
    status.value = t('statusSaved');
  } catch (error) {
    statusTone.value = 'error';
    status.value = t('statusSaveFailed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  } finally {
    isSaving.value = false;
  }
}

async function reloadSettings(): Promise<void> {
  try {
    const loaded = await loadSettings();
    const normalized = validateUserSettings(loaded).normalized;
    settings.value = structuredClone(normalized);
    savedSettingsSnapshot.value = structuredClone(normalized);
    statusTone.value = 'neutral';
    status.value = t('statusSettingsLoaded');
  } catch (error) {
    statusTone.value = 'error';
    status.value = t('statusLoadFailed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

function revertChanges(): void {
  if (!savedSettingsSnapshot.value) {
    return;
  }
  settings.value = structuredClone(savedSettingsSnapshot.value);
  statusTone.value = 'neutral';
  status.value = t('statusChangesReverted');
}
</script>
