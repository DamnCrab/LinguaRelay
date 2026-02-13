import type { TranscriptSegment } from '../../shared/contracts';

const OVERLAY_ID = 'linguarelay-live-overlay-root';
const STORAGE_PREFIX = 'linguarelay:overlay-style:v1:';

interface SubtitleOverlayOptions {
  siteId: string;
  title?: string;
  autoSnapSupported?: boolean;
  getAnchorRect?: () => DOMRect | null;
}

interface OverlayStyleState {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
  autoSnap: boolean;
}

const DEFAULT_STYLE: OverlayStyleState = {
  x: 48,
  y: 48,
  width: 760,
  height: 170,
  fontSize: 28,
  backgroundColor: '#000000',
  backgroundOpacity: 0.52,
  autoSnap: true,
};

export class SubtitleOverlay {
  private readonly options: SubtitleOverlayOptions;
  private readonly storageKey: string;

  private host: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private sourceLine: HTMLDivElement | null = null;
  private translatedLine: HTMLDivElement | null = null;
  private statusLine: HTMLDivElement | null = null;
  private settingsPanel: HTMLDivElement | null = null;
  private autoSnapInput: HTMLInputElement | null = null;
  private fontSizeInput: HTMLInputElement | null = null;
  private colorInput: HTMLInputElement | null = null;
  private opacityInput: HTMLInputElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private autoSnapTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private styleState: OverlayStyleState = { ...DEFAULT_STYLE };
  private dragging = false;
  private dragPointerId: number | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private suppressResizeObserver = false;
  private windowResizeHandler: (() => void) | null = null;
  private windowScrollHandler: (() => void) | null = null;
  private documentPointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  private documentPointerUpHandler: ((event: PointerEvent) => void) | null = null;

  constructor(options: SubtitleOverlayOptions) {
    this.options = options;
    this.storageKey = `${STORAGE_PREFIX}${options.siteId}`;
    this.styleState.autoSnap = options.autoSnapSupported ? DEFAULT_STYLE.autoSnap : false;
  }

  public attach(): void {
    // Force single overlay host per page even if content script gets injected multiple times.
    for (const duplicate of document.querySelectorAll<HTMLElement>(`#${OVERLAY_ID}`)) {
      if (this.host && duplicate === this.host) {
        continue;
      }
      duplicate.remove();
    }

    if (this.host && document.documentElement.contains(this.host)) {
      return;
    }

    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .panel {
        position: absolute;
        pointer-events: auto;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 12px;
        overflow: hidden;
        resize: both;
        min-width: 260px;
        min-height: 100px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(2px);
        color: #ffffff;
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 10px;
        background: rgba(15, 23, 42, 0.68);
        border-bottom: 1px solid rgba(255, 255, 255, 0.18);
      }
      .title {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.9);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        user-select: none;
      }
      .drag {
        cursor: move;
      }
      .tools {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .icon-button {
        border: 1px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        border-radius: 6px;
        font-size: 12px;
        padding: 2px 8px;
        cursor: pointer;
      }
      .content {
        padding: 8px 10px 10px;
      }
      .line {
        display: block;
        text-align: center;
        margin: 2px auto;
        line-height: 1.42;
        word-break: break-word;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.85);
      }
      .translated {
        color: #e2e8f0;
      }
      .status {
        margin-top: 6px;
        text-align: center;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.86);
      }
      .settings {
        margin-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.16);
        padding-top: 8px;
        display: none;
      }
      .settings.open {
        display: block;
      }
      .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 6px 0;
        font-size: 12px;
      }
      .setting-row label {
        color: rgba(255, 255, 255, 0.92);
      }
      .setting-row input[type="range"] {
        flex: 1;
      }
      .setting-row input[type="color"] {
        width: 44px;
        height: 26px;
        padding: 0;
        border: none;
        background: transparent;
      }
      .setting-row button {
        border: 1px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        border-radius: 6px;
        font-size: 12px;
        padding: 3px 8px;
        cursor: pointer;
      }
      .hidden {
        display: none !important;
      }
    `;

    const panel = document.createElement('div');
    panel.className = 'panel';

    const topbar = document.createElement('div');
    topbar.className = 'topbar drag';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = this.options.title ?? 'LinguaRelay Subtitles';

    const tools = document.createElement('div');
    tools.className = 'tools';

    const toggleSettingsButton = document.createElement('button');
    toggleSettingsButton.className = 'icon-button';
    toggleSettingsButton.type = 'button';
    toggleSettingsButton.textContent = 'Style';

    tools.append(toggleSettingsButton);
    topbar.append(title, tools);

    const content = document.createElement('div');
    content.className = 'content';

    const sourceLine = document.createElement('div');
    sourceLine.className = 'line';

    const translatedLine = document.createElement('div');
    translatedLine.className = 'line translated';

    const statusLine = document.createElement('div');
    statusLine.className = 'status';

    const settings = document.createElement('div');
    settings.className = 'settings';

    const fontSizeRow = document.createElement('div');
    fontSizeRow.className = 'setting-row';
    const fontSizeLabel = document.createElement('label');
    fontSizeLabel.textContent = 'Font Size';
    const fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'range';
    fontSizeInput.min = '14';
    fontSizeInput.max = '56';
    fontSizeInput.step = '1';
    fontSizeRow.append(fontSizeLabel, fontSizeInput);

    const backgroundRow = document.createElement('div');
    backgroundRow.className = 'setting-row';
    const backgroundLabel = document.createElement('label');
    backgroundLabel.textContent = 'Background';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    backgroundRow.append(backgroundLabel, colorInput);

    const opacityRow = document.createElement('div');
    opacityRow.className = 'setting-row';
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacity';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0.05';
    opacityInput.max = '0.95';
    opacityInput.step = '0.01';
    opacityRow.append(opacityLabel, opacityInput);

    const autoSnapRow = document.createElement('div');
    autoSnapRow.className = 'setting-row';
    const autoSnapLabel = document.createElement('label');
    autoSnapLabel.textContent = 'Auto Snap to Video';
    const autoSnapInput = document.createElement('input');
    autoSnapInput.type = 'checkbox';
    autoSnapRow.append(autoSnapLabel, autoSnapInput);
    if (!this.options.autoSnapSupported) {
      autoSnapRow.classList.add('hidden');
    }

    const resetRow = document.createElement('div');
    resetRow.className = 'setting-row';
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset';
    resetRow.append(resetButton);

    settings.append(fontSizeRow, backgroundRow, opacityRow, autoSnapRow, resetRow);
    content.append(sourceLine, translatedLine, statusLine, settings);
    panel.append(topbar, content);
    shadow.append(style, panel);

    this.host = host;
    this.panel = panel;
    this.sourceLine = sourceLine;
    this.translatedLine = translatedLine;
    this.statusLine = statusLine;
    this.settingsPanel = settings;
    this.autoSnapInput = autoSnapInput;
    this.fontSizeInput = fontSizeInput;
    this.colorInput = colorInput;
    this.opacityInput = opacityInput;

    document.documentElement.append(host);

    topbar.addEventListener('pointerdown', this.handleDragStart);
    toggleSettingsButton.addEventListener('click', this.toggleSettings);
    resetButton.addEventListener('click', this.resetStyle);

    autoSnapInput.addEventListener('change', () => {
      if (!this.options.autoSnapSupported) {
        return;
      }
      this.styleState.autoSnap = autoSnapInput.checked;
      this.schedulePersist();
      this.syncAutoSnap();
      this.updateAutoSnapLoop();
    });

    fontSizeInput.addEventListener('input', () => {
      this.styleState.fontSize = Number.parseInt(fontSizeInput.value, 10) || DEFAULT_STYLE.fontSize;
      this.applyVisualStyle();
      this.schedulePersist();
    });

    colorInput.addEventListener('input', () => {
      this.styleState.backgroundColor = colorInput.value || DEFAULT_STYLE.backgroundColor;
      this.applyVisualStyle();
      this.schedulePersist();
    });

    opacityInput.addEventListener('input', () => {
      const value = Number.parseFloat(opacityInput.value);
      this.styleState.backgroundOpacity = clamp(value, 0.05, 0.95);
      this.applyVisualStyle();
      this.schedulePersist();
    });

    this.resizeObserver = new ResizeObserver((entries) => {
      if (this.suppressResizeObserver) {
        return;
      }
      const entry = entries[0];
      if (!entry || !this.panel) {
        return;
      }

      if (this.options.autoSnapSupported && this.styleState.autoSnap) {
        this.styleState.autoSnap = false;
        if (this.autoSnapInput) {
          this.autoSnapInput.checked = false;
        }
        this.updateAutoSnapLoop();
      }

      this.styleState.width = Math.round(this.panel.offsetWidth);
      this.styleState.height = Math.round(this.panel.offsetHeight);
      this.schedulePersist();
    });
    this.resizeObserver.observe(panel);

    this.windowResizeHandler = () => {
      this.syncAutoSnap();
      this.applyGeometry();
    };
    this.windowScrollHandler = () => {
      this.syncAutoSnap();
    };
    window.addEventListener('resize', this.windowResizeHandler);
    window.addEventListener('scroll', this.windowScrollHandler, true);

    this.documentPointerMoveHandler = this.handleDragMove;
    this.documentPointerUpHandler = this.handleDragEnd;
    document.addEventListener('pointermove', this.documentPointerMoveHandler);
    document.addEventListener('pointerup', this.documentPointerUpHandler);

    this.applyGeometry();
    this.applyVisualStyle();
    this.updateInputValues();

    void this.loadPersistedState();
  }

  public update(segment: TranscriptSegment): void {
    this.attach();
    if (!this.sourceLine || !this.translatedLine) {
      return;
    }

    this.sourceLine.textContent = segment.text;

    if (segment.translatedText && segment.translatedText.trim().length > 0) {
      this.translatedLine.style.display = 'block';
      this.translatedLine.textContent = segment.translatedText;
    } else {
      this.translatedLine.style.display = 'none';
      this.translatedLine.textContent = '';
    }
  }

  public setStatus(text: string): void {
    this.attach();
    if (!this.statusLine) {
      return;
    }
    this.statusLine.textContent = text;
  }

  public clear(): void {
    if (this.sourceLine) {
      this.sourceLine.textContent = '';
    }
    if (this.translatedLine) {
      this.translatedLine.textContent = '';
      this.translatedLine.style.display = 'none';
    }
    if (this.statusLine) {
      this.statusLine.textContent = '';
    }
  }

  public dispose(): void {
    this.clear();
    this.stopAutoSnapLoop();

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    }
    if (this.windowScrollHandler) {
      window.removeEventListener('scroll', this.windowScrollHandler, true);
      this.windowScrollHandler = null;
    }
    if (this.documentPointerMoveHandler) {
      document.removeEventListener('pointermove', this.documentPointerMoveHandler);
      this.documentPointerMoveHandler = null;
    }
    if (this.documentPointerUpHandler) {
      document.removeEventListener('pointerup', this.documentPointerUpHandler);
      this.documentPointerUpHandler = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.host?.remove();
    this.host = null;
    this.panel = null;
    this.sourceLine = null;
    this.translatedLine = null;
    this.statusLine = null;
    this.settingsPanel = null;
    this.autoSnapInput = null;
    this.fontSizeInput = null;
    this.colorInput = null;
    this.opacityInput = null;
  }

  private toggleSettings = (): void => {
    if (!this.settingsPanel) {
      return;
    }
    this.settingsPanel.classList.toggle('open');
  };

  private resetStyle = (): void => {
    const defaults = { ...DEFAULT_STYLE };
    defaults.autoSnap = this.options.autoSnapSupported ? defaults.autoSnap : false;
    this.styleState = defaults;
    this.syncAutoSnap();
    this.applyGeometry();
    this.applyVisualStyle();
    this.updateInputValues();
    this.schedulePersist();
    this.updateAutoSnapLoop();
  };

  private handleDragStart = (event: PointerEvent): void => {
    if (!this.panel) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    this.dragging = true;
    this.dragPointerId = event.pointerId;
    this.dragOffsetX = event.clientX - this.styleState.x;
    this.dragOffsetY = event.clientY - this.styleState.y;

    if (this.options.autoSnapSupported && this.styleState.autoSnap) {
      this.styleState.autoSnap = false;
      if (this.autoSnapInput) {
        this.autoSnapInput.checked = false;
      }
      this.updateAutoSnapLoop();
    }

    this.panel.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private handleDragMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    if (this.dragPointerId !== event.pointerId) {
      return;
    }

    const x = event.clientX - this.dragOffsetX;
    const y = event.clientY - this.dragOffsetY;
    this.styleState.x = x;
    this.styleState.y = y;
    this.applyGeometry();
    this.schedulePersist();
  };

  private handleDragEnd = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    if (this.dragPointerId !== event.pointerId) {
      return;
    }
    this.dragging = false;
    this.dragPointerId = null;
    this.schedulePersist();
  };

  private applyGeometry(): void {
    if (!this.panel) {
      return;
    }

    const maxWidth = Math.max(260, window.innerWidth - 16);
    const maxHeight = Math.max(100, window.innerHeight - 16);
    this.styleState.width = clamp(this.styleState.width, 260, maxWidth);
    this.styleState.height = clamp(this.styleState.height, 100, maxHeight);
    this.styleState.x = clamp(this.styleState.x, 8 - this.styleState.width + 64, window.innerWidth - 64);
    this.styleState.y = clamp(this.styleState.y, 8, window.innerHeight - 48);

    this.suppressResizeObserver = true;
    this.panel.style.left = `${Math.round(this.styleState.x)}px`;
    this.panel.style.top = `${Math.round(this.styleState.y)}px`;
    this.panel.style.width = `${Math.round(this.styleState.width)}px`;
    this.panel.style.height = `${Math.round(this.styleState.height)}px`;

    queueMicrotask(() => {
      this.suppressResizeObserver = false;
    });
  }

  private applyVisualStyle(): void {
    if (!this.panel || !this.sourceLine || !this.translatedLine) {
      return;
    }

    const [r, g, b] = hexToRgb(this.styleState.backgroundColor);
    this.panel.style.background = `rgba(${r}, ${g}, ${b}, ${this.styleState.backgroundOpacity})`;
    const size = clamp(this.styleState.fontSize, 14, 56);
    this.sourceLine.style.fontSize = `${size}px`;
    this.translatedLine.style.fontSize = `${Math.max(14, Math.round(size * 0.86))}px`;
  }

  private updateInputValues(): void {
    if (this.fontSizeInput) {
      this.fontSizeInput.value = String(Math.round(this.styleState.fontSize));
    }
    if (this.colorInput) {
      this.colorInput.value = this.styleState.backgroundColor;
    }
    if (this.opacityInput) {
      this.opacityInput.value = this.styleState.backgroundOpacity.toFixed(2);
    }
    if (this.autoSnapInput) {
      this.autoSnapInput.checked = Boolean(this.options.autoSnapSupported && this.styleState.autoSnap);
    }
  }

  private syncAutoSnap(): void {
    if (!this.options.autoSnapSupported || !this.styleState.autoSnap) {
      return;
    }

    const rect = this.options.getAnchorRect?.() ?? null;
    if (!rect) {
      return;
    }
    if (rect.width < 120 || rect.height < 80) {
      return;
    }

    const desiredWidth = clamp(rect.width - 24, 320, window.innerWidth - 16);
    const desiredHeight = clamp(this.styleState.height, 100, Math.max(100, rect.height * 0.55));
    const desiredX = rect.left + (rect.width - desiredWidth) / 2;
    const desiredY = rect.bottom - desiredHeight - 12;

    this.styleState.width = desiredWidth;
    this.styleState.height = desiredHeight;
    this.styleState.x = desiredX;
    this.styleState.y = desiredY;
    this.applyGeometry();
  }

  private updateAutoSnapLoop(): void {
    if (this.options.autoSnapSupported && this.styleState.autoSnap) {
      if (this.autoSnapTimer) {
        return;
      }
      this.autoSnapTimer = setInterval(() => {
        this.syncAutoSnap();
      }, 450);
      return;
    }

    this.stopAutoSnapLoop();
  }

  private stopAutoSnapLoop(): void {
    if (!this.autoSnapTimer) {
      return;
    }
    clearInterval(this.autoSnapTimer);
    this.autoSnapTimer = null;
  }

  private schedulePersist(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      void this.persistState();
    }, 160);
  }

  private async loadPersistedState(): Promise<void> {
    const stored = await readFromStorage<Partial<OverlayStyleState>>(this.storageKey);
    if (!stored || typeof stored !== 'object') {
      this.updateAutoSnapLoop();
      this.syncAutoSnap();
      return;
    }

    this.styleState = {
      ...this.styleState,
      ...normalizeStyle(stored),
      autoSnap: this.options.autoSnapSupported
        ? Boolean(stored.autoSnap ?? this.styleState.autoSnap)
        : false,
    };

    this.applyGeometry();
    this.applyVisualStyle();
    this.updateInputValues();
    this.updateAutoSnapLoop();
    this.syncAutoSnap();
  }

  private async persistState(): Promise<void> {
    const payload: OverlayStyleState = {
      ...this.styleState,
      x: Math.round(this.styleState.x),
      y: Math.round(this.styleState.y),
      width: Math.round(this.styleState.width),
      height: Math.round(this.styleState.height),
      fontSize: Math.round(this.styleState.fontSize),
      backgroundOpacity: Number(this.styleState.backgroundOpacity.toFixed(2)),
      autoSnap: Boolean(this.styleState.autoSnap && this.options.autoSnapSupported),
    };

    await writeToStorage(this.storageKey, payload);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function hexToRgb(hex: string): [number, number, number] {
  const sanitized = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return [0, 0, 0];
  }
  const r = Number.parseInt(sanitized.slice(0, 2), 16);
  const g = Number.parseInt(sanitized.slice(2, 4), 16);
  const b = Number.parseInt(sanitized.slice(4, 6), 16);
  return [r, g, b];
}

function normalizeStyle(input: Partial<OverlayStyleState>): Partial<OverlayStyleState> {
  return {
    x: Number.isFinite(input.x) ? Number(input.x) : undefined,
    y: Number.isFinite(input.y) ? Number(input.y) : undefined,
    width: Number.isFinite(input.width) ? Number(input.width) : undefined,
    height: Number.isFinite(input.height) ? Number(input.height) : undefined,
    fontSize: Number.isFinite(input.fontSize) ? Number(input.fontSize) : undefined,
    backgroundColor:
      typeof input.backgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.backgroundColor)
        ? input.backgroundColor
        : undefined,
    backgroundOpacity: Number.isFinite(input.backgroundOpacity)
      ? clamp(Number(input.backgroundOpacity), 0.05, 0.95)
      : undefined,
  };
}

async function readFromStorage<T>(key: string): Promise<T | null> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.local ||
    typeof chrome.storage.local.get !== 'function'
  ) {
    return null;
  }

  try {
    return await new Promise<T | null>((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve((result?.[key] as T | undefined) ?? null);
      });
    });
  } catch {
    return null;
  }
}

async function writeToStorage<T>(key: string, value: T): Promise<void> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.local ||
    typeof chrome.storage.local.set !== 'function'
  ) {
    return;
  }

  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}
