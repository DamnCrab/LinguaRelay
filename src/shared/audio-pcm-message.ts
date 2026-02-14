export function encodePcm16ForMessage(buffer: ArrayBuffer): number[] {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    return [];
  }
  return Array.from(new Int16Array(buffer));
}

export function decodePcm16FromMessage(payload: unknown): ArrayBuffer | null {
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength > 0 ? payload : null;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return null;
    }
    const out = new Int16Array(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      out[i] = toInt16(payload[i]);
    }
    return out.buffer;
  }

  return null;
}

function toInt16(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const rounded = Math.round(n);
  if (rounded > 32767) {
    return 32767;
  }
  if (rounded < -32768) {
    return -32768;
  }
  return rounded;
}
