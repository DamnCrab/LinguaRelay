<template>
  <main class="container" v-if="settings">
    <h1>LinguaRelay 高级设置</h1>

    <section class="panel">
      <h3>在线 ASR</h3>
      <div class="grid">
        <div>
          <label>模式</label>
          <select v-model="settings.asr.mode">
            <option value="online-gateway">online-gateway</option>
            <option value="local-onnx">local-onnx</option>
          </select>
        </div>
        <div>
          <label>语言</label>
          <input v-model="settings.asr.language" placeholder="auto / ja / en" />
        </div>
      </div>

      <div v-if="settings.asr.mode === 'online-gateway'" class="grid" style="margin-top: 12px">
        <div>
          <label>WebSocket URL</label>
          <input v-model="settings.asr.wsUrl" />
        </div>
        <div>
          <label>模型ID</label>
          <input v-model="settings.asr.model" />
        </div>
        <div>
          <label>API Key</label>
          <input v-model="settings.asr.apiKey" type="password" />
        </div>
      </div>

      <div v-else class="grid" style="margin-top: 12px">
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
    </section>

    <section class="panel">
      <h3>翻译 LLM</h3>
      <div class="grid">
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
        <div>
          <label>目标语言</label>
          <input v-model="settings.translation.targetLanguage" />
        </div>
        <div>
          <label>源语言</label>
          <input v-model="settings.translation.sourceLanguage" />
        </div>
        <div>
          <label>Endpoint</label>
          <input v-model="settings.translation.endpoint" />
        </div>
        <div>
          <label>Model</label>
          <input v-model="settings.translation.model" />
        </div>
        <div>
          <label>API Key</label>
          <input v-model="settings.translation.apiKey" type="password" />
        </div>
      </div>
    </section>

    <section class="panel">
      <h3>运行时限制</h3>
      <div class="grid">
        <div>
          <label>最大并发会话</label>
          <input v-model.number="settings.runtime.maxSessions" type="number" min="1" max="12" />
        </div>
        <div>
          <label>引擎空闲卸载(ms)</label>
          <input v-model.number="settings.runtime.engineIdleDisposeMs" type="number" min="10000" />
        </div>
        <div>
          <label>音频队列上限</label>
          <input v-model.number="settings.runtime.maxPendingAudioChunks" type="number" min="4" max="128" />
        </div>
        <div>
          <label>翻译 partial 字幕</label>
          <select v-model="settings.runtime.partialTranslation">
            <option :value="true">true</option>
            <option :value="false">false</option>
          </select>
        </div>
      </div>
    </section>

    <section class="panel">
      <h3>浏览器兼容建议</h3>
      <div class="tip">
        Chromium: 推荐，MV3 + YouTube 音频链路最稳定。<br />
        Firefox: 内容脚本注入和 WebAudio 行为需回归测试，尽量保持最小权限。<br />
        Safari: 通过 Safari Web Extension 转换后再调试，部分 API 需降级。<br />
        发布时请分别准备 Chrome Web Store、Edge Add-ons、AMO、Safari App Store 的包与审核材料。
      </div>
    </section>

    <button @click="save">保存设置</button>
    <span style="margin-left: 8px" class="tip">{{ status }}</span>
  </main>

  <main v-else class="container">加载中...</main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { UserSettings } from '../../shared/contracts';
import { loadSettings, saveSettings } from '../../shared/runtime-api';

const settings = ref<UserSettings | null>(null);
const status = ref('');

onMounted(async () => {
  settings.value = structuredClone(await loadSettings());
});

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
</script>

