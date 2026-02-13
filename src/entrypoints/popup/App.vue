<template>
  <div class="app" v-if="settings">
    <h1>LinguaRelay Live</h1>
    <div class="small">YouTube 直播实时转写 / 翻译</div>

    <section class="card">
      <div class="status">ASR 设置</div>
      <div class="grid" style="margin-top: 8px">
        <div>
          <label>模式</label>
          <select v-model="settings.asr.mode">
            <option value="online-gateway">online-gateway</option>
            <option value="local-onnx">local-onnx</option>
          </select>
        </div>

        <div>
          <label>语言</label>
          <input v-model="settings.asr.language" placeholder="auto / en / ja" />
        </div>
      </div>

      <template v-if="settings.asr.mode === 'online-gateway'">
        <div style="margin-top: 8px">
          <label>WebSocket URL</label>
          <input v-model="settings.asr.wsUrl" placeholder="ws://127.0.0.1:18080/v1/asr/stream" />
        </div>
        <div class="grid" style="margin-top: 8px">
          <div>
            <label>模型</label>
            <input v-model="settings.asr.model" placeholder="whisper-large-v3-turbo" />
          </div>
          <div>
            <label>API Key (可选)</label>
            <input v-model="settings.asr.apiKey" type="password" />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="grid" style="margin-top: 8px">
          <div>
            <label>模型</label>
            <select v-model="settings.asr.model">
              <option value="whisper-large-v3-turbo">whisper-large-v3-turbo</option>
              <option value="whisper-large-v3-onnx">whisper-large-v3-onnx</option>
            </select>
          </div>
          <div>
            <label>量化</label>
            <select v-model="settings.asr.precision">
              <option value="q4f16">q4f16</option>
              <option value="q4">q4</option>
              <option value="fp16">fp16</option>
            </select>
          </div>
        </div>
      </template>
    </section>

    <section class="card">
      <div class="status">翻译设置</div>
      <div class="grid" style="margin-top: 8px">
        <div>
          <label>启用翻译</label>
          <select v-model="settings.translation.enabled">
            <option :value="true">true</option>
            <option :value="false">false</option>
          </select>
        </div>
        <div>
          <label>Provider</label>
          <select v-model="settings.translation.provider">
            <option value="openai-compatible">openai-compatible</option>
            <option value="none">none</option>
          </select>
        </div>
      </div>

      <div class="grid" style="margin-top: 8px">
        <div>
          <label>目标语言</label>
          <input v-model="settings.translation.targetLanguage" placeholder="zh-CN" />
        </div>
        <div>
          <label>源语言</label>
          <input v-model="settings.translation.sourceLanguage" placeholder="auto" />
        </div>
      </div>

      <template v-if="settings.translation.enabled && settings.translation.provider === 'openai-compatible'">
        <div style="margin-top: 8px">
          <label>Endpoint</label>
          <input v-model="settings.translation.endpoint" placeholder="https://api.openai.com/v1/chat/completions" />
        </div>
        <div class="grid" style="margin-top: 8px">
          <div>
            <label>Model</label>
            <input v-model="settings.translation.model" placeholder="gpt-5-mini" />
          </div>
          <div>
            <label>API Key</label>
            <input v-model="settings.translation.apiKey" type="password" />
          </div>
        </div>
      </template>
    </section>

    <section class="card">
      <div class="status">运行与兼容</div>
      <div class="small" style="margin-top: 4px">
        浏览器: {{ runtimeInfo?.browser ?? '-' }} |
        WebGPU: {{ runtimeInfo?.support.webgpu ?? false }} |
        AudioWorklet: {{ runtimeInfo?.support.audioWorklet ?? false }}
      </div>
      <div class="small" style="margin-top: 4px">
        建议 Chromium 内核优先，Firefox/Safari 需额外验证音频抓取链路。
      </div>
    </section>

    <section class="card">
      <div class="status">会话状态</div>
      <div v-if="sessions.length === 0" class="small" style="margin-top: 6px">暂无活跃会话</div>
      <div v-for="session in sessions" :key="session.sessionId" class="session">
        <div>
          <span class="badge">{{ session.state }}</span>
          <span class="small"> tab={{ session.tabId }} frame={{ session.frameId }}</span>
        </div>
        <div class="small" style="margin-top: 4px">{{ session.asrEngine }}</div>
        <div class="small">dropped={{ session.droppedAudioChunks }}</div>
      </div>
    </section>

    <div class="row">
      <button class="primary" @click="save">保存</button>
      <button class="secondary" @click="refresh">刷新</button>
      <button class="secondary" @click="openOptions">高级设置</button>
    </div>

    <div class="small" style="margin-top: 8px">{{ status }}</div>
  </div>

  <div v-else class="app">加载中...</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import type { SessionRuntimeStatus, UserSettings } from '../../shared/contracts';
import { getRuntimeInfo, listSessions, loadSettings, saveSettings } from '../../shared/runtime-api';

const settings = ref<UserSettings | null>(null);
const sessions = ref<SessionRuntimeStatus[]>([]);
const runtimeInfo = ref<Awaited<ReturnType<typeof getRuntimeInfo>> | null>(null);
const status = ref('');

let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await refresh();
  refreshTimer = setInterval(() => {
    void refreshSessions();
  }, 2000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

async function refresh(): Promise<void> {
  try {
    const [loadedSettings, loadedSessions, info] = await Promise.all([
      loadSettings(),
      listSessions(),
      getRuntimeInfo(),
    ]);
    settings.value = structuredClone(loadedSettings);
    sessions.value = loadedSessions;
    runtimeInfo.value = info;
    status.value = '设置已加载';
  } catch (error) {
    status.value = `加载失败: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function refreshSessions(): Promise<void> {
  sessions.value = await listSessions();
}

async function save(): Promise<void> {
  if (!settings.value) {
    return;
  }

  try {
    await saveSettings(settings.value);
    status.value = '保存成功';
  } catch (error) {
    status.value = `保存失败: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}
</script>

