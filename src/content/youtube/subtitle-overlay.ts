import type { TranscriptSegment } from '../../shared/contracts';

const OVERLAY_ID = 'linguarelay-live-overlay-root';

export class SubtitleOverlay {
  private host: HTMLDivElement | null = null;
  private sourceLine: HTMLDivElement | null = null;
  private translatedLine: HTMLDivElement | null = null;
  private statusLine: HTMLDivElement | null = null;

  public attach(): void {
    if (this.host && document.body.contains(this.host)) {
      return;
    }

    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.right = '0';
    host.style.bottom = '8%';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .wrap {
        margin: 0 auto;
        max-width: min(100%, 1100px);
        padding: 0 16px;
        font-family: "Noto Sans SC", "PingFang SC", "Microsoft Yahei", sans-serif;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
      }
      .line {
        display: block;
        text-align: center;
        margin: 2px auto;
        padding: 4px 10px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.48);
        width: fit-content;
        max-width: 100%;
        line-height: 1.45;
        font-size: clamp(16px, 1.8vw, 26px);
        word-break: break-word;
      }
      .translated {
        color: #f5f7ff;
        background: rgba(18, 26, 52, 0.62);
      }
      .status {
        margin-top: 8px;
        text-align: center;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.82);
      }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    this.sourceLine = document.createElement('div');
    this.sourceLine.className = 'line';

    this.translatedLine = document.createElement('div');
    this.translatedLine.className = 'line translated';

    this.statusLine = document.createElement('div');
    this.statusLine.className = 'status';

    wrap.append(this.sourceLine, this.translatedLine, this.statusLine);
    shadow.append(style, wrap);

    this.host = host;
    document.documentElement.append(host);
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
    this.host?.remove();
    this.host = null;
    this.sourceLine = null;
    this.translatedLine = null;
    this.statusLine = null;
  }
}



