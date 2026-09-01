export interface SseFrame {
  event: string;
  data: unknown;
}

/**
 * Incremental SSE parser.
 *
 * The browser EventSource API cannot be used here: it only issues GET requests and
 * cannot carry an Authorization header. The stream is therefore read from fetch and
 * framed by hand. Chunk boundaries never align with frame boundaries, so the parser
 * keeps a buffer and only emits complete frames.
 */
const MAX_BUFFER = 1_000_000;

export class SseParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    // Servers disagree on line endings: sse_starlette emits CRLF while others emit
    // LF. Normalizing on the way in keeps frame separation independent of that.
    this.buffer += chunk.replace(/\r\n/g, "\n");
    if (this.buffer.length > MAX_BUFFER) {
      throw new Error("sse frame exceeded the maximum buffer size");
    }
    const frames: SseFrame[] = [];

    let separator = this.buffer.indexOf("\n\n");
    while (separator !== -1) {
      const rawFrame = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const parsed = parseFrame(rawFrame);
      if (parsed) frames.push(parsed);
      separator = this.buffer.indexOf("\n\n");
    }

    return frames;
  }

  flush(): SseFrame[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return [];
    const parsed = parseFrame(remaining);
    return parsed ? [parsed] : [];
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(payload) };
  } catch {
    return { event, data: payload };
  }
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        yield frame;
      }
    }
    for (const frame of parser.flush()) {
      yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}
