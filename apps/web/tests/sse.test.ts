import { describe, expect, it } from "vitest";

import { SseParser, readSse } from "../src/api/sse.js";

describe("SseParser", () => {
  it("parses a complete frame", () => {
    const parser = new SseParser();
    const frames = parser.push('event: token\ndata: {"text":"hi"}\n\n');
    expect(frames).toEqual([{ event: "token", data: { text: "hi" } }]);
  });

  it("holds an incomplete frame until the rest arrives", () => {
    const parser = new SseParser();
    expect(parser.push('event: token\ndata: {"te')).toEqual([]);
    expect(parser.push('xt":"hello"}\n\n')).toEqual([{ event: "token", data: { text: "hello" } }]);
  });

  it("emits several frames arriving in one chunk", () => {
    const parser = new SseParser();
    const frames = parser.push(
      'event: token\ndata: {"text":"a"}\n\nevent: token\ndata: {"text":"b"}\n\n',
    );
    expect(frames.map((frame) => (frame.data as { text: string }).text)).toEqual(["a", "b"]);
  });

  it("splits a frame across three chunks", () => {
    const parser = new SseParser();
    expect(parser.push("event: don")).toEqual([]);
    expect(parser.push('e\ndata: {"stop_rea')).toEqual([]);
    expect(parser.push('son":"end_turn"}\n\n')).toEqual([
      { event: "done", data: { stop_reason: "end_turn" } },
    ]);
  });

  it("ignores comment lines used as keepalive", () => {
    const parser = new SseParser();
    expect(parser.push(": keepalive\n\n")).toEqual([]);
  });

  it("keeps non JSON payloads as text", () => {
    const parser = new SseParser();
    expect(parser.push("event: note\ndata: plain text\n\n")).toEqual([
      { event: "note", data: "plain text" },
    ]);
  });

  it("joins multi line data fields", () => {
    const parser = new SseParser();
    const frames = parser.push("event: note\ndata: first\ndata: second\n\n");
    expect(frames[0]?.data).toBe("first\nsecond");
  });

  it("flushes a trailing frame that never got its blank line", () => {
    const parser = new SseParser();
    expect(parser.push('event: done\ndata: {"stop_reason":"end_turn"}')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "done", data: { stop_reason: "end_turn" } }]);
  });

  it("defaults the event name when only data is present", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}\n\n')).toEqual([{ event: "message", data: { a: 1 } }]);
  });
});

describe("readSse", () => {
  it("yields frames from a byte stream split at awkward boundaries", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: ready\ndata: {"tools":["a"]'));
        controller.enqueue(encoder.encode("}\n\nevent: token\ndata: "));
        controller.enqueue(encoder.encode('{"text":"ok"}\n\n'));
        controller.close();
      },
    });

    const seen: string[] = [];
    for await (const frame of readSse(stream)) {
      seen.push(frame.event);
    }
    expect(seen).toEqual(["ready", "token"]);
  });
});

describe("line endings", () => {
  it("separates frames delimited with CRLF", () => {
    const parser = new SseParser();
    const frames = parser.push('event: token\r\ndata: {"text":"hi"}\r\n\r\n');
    expect(frames).toEqual([{ event: "token", data: { text: "hi" } }]);
  });

  it("handles a CRLF stream split mid separator", () => {
    const parser = new SseParser();
    expect(parser.push('event: token\r\ndata: {"text":"a"}\r\n')).toEqual([]);
    expect(parser.push('\r\nevent: done\r\ndata: {"stop_reason":"end_turn"}\r\n\r\n')).toEqual([
      { event: "token", data: { text: "a" } },
      { event: "done", data: { stop_reason: "end_turn" } },
    ]);
  });

  it("keeps every field of a CRLF done frame", () => {
    const parser = new SseParser();
    const frames = parser.push(
      'event: done\r\ndata: {"stop_reason":"end_turn","latency_ms":42,"usage":{"total_tokens":246}}\r\n\r\n',
    );
    expect(frames[0]?.data).toMatchObject({ latency_ms: 42, usage: { total_tokens: 246 } });
  });
});

describe("buffer bounds", () => {
  it("throws instead of growing without bound when no separator ever arrives", () => {
    const parser = new SseParser();
    expect(() => parser.push("x".repeat(1_000_001))).toThrow(/maximum buffer/);
  });
});
