import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

interface StreamCall {
  authorization: string;
  body: { message: string; session_id: string };
}

let streamCalls: StreamCall[];
let loginStatus: number;
let streamStatus: number;
let frames: string[];

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const DEFAULT_FRAMES = [
  'event: ready\ndata: {"tools":["list_invoices","list_plans"],"model_id":"scripted"}\n\n',
  'event: tool_call\ndata: {"name":"list_invoices"}\n\n',
  'event: token\ndata: {"text":"3 invoices, "}\n\n',
  'event: token\ndata: {"text":"1 overdue."}\n\n',
  'event: done\ndata: {"stop_reason":"end_turn","latency_ms":42,"usage":{"total_tokens":246}}\n\n',
];

beforeEach(() => {
  streamCalls = [];
  loginStatus = 200;
  streamStatus = 200;
  frames = DEFAULT_FRAMES;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;

      if (String(url).endsWith("/v1/auth/login")) {
        if (loginStatus !== 200) {
          return new Response(JSON.stringify({ code: "invalid_credentials" }), {
            status: loginStatus,
          });
        }
        return new Response(
          JSON.stringify({
            access_token: "session-token",
            user: {
              subject: "user-marina",
              display_name: "Marina Andrade",
              actor: "subscriber",
              customer_id: "CUS-1001",
              scopes: ["billing:read"],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      streamCalls.push({
        authorization: headers.authorization ?? "",
        body: JSON.parse(String(init?.body ?? "{}")),
      });

      if (streamStatus !== 200) {
        return new Response("nope", { status: streamStatus });
      }
      return new Response(sseBody(frames), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signIn(user = userEvent.setup()) {
  await user.type(screen.getByLabelText(/username/i), "marina");
  await user.type(screen.getByLabelText(/password/i), "demo1234");
  await user.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByPlaceholderText("Type a message");
  return user;
}

describe("sign in", () => {
  it("shows the login form first", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /onda telecom/i })).toBeInTheDocument();
  });

  it("moves to the chat and keeps the signed-in identity accessible", async () => {
    render(<App />);
    await signIn();
    expect(screen.getByText(/signed in as Marina Andrade/i)).toBeInTheDocument();
  });

  it("shows an error for invalid credentials and stays on the form", async () => {
    loginStatus = 401;
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), "marina");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid username or password/i);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("signing out returns to the form", async () => {
    render(<App />);
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});

describe("streaming a turn", () => {
  it("renders the streamed answer assembled from token frames", async () => {
    render(<App />);
    const user = await signIn();

    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("3 invoices, 1 overdue.")).toBeInTheDocument();
    });
  });

  it("shows how many tools the caller is entitled to in the header", async () => {
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 tools available to you/)).toBeInTheDocument();
    });
  });

  it("shows which tool the assistant used and the turn cost", async () => {
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/246 tokens/)).toBeInTheDocument();
    });
    expect(screen.getByText("list_invoices")).toBeInTheDocument();
  });

  it("echoes the user message before the answer arrives", async () => {
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(screen.getByText("show my invoice")).toBeInTheDocument();
  });

  it("sends the session token and keeps one session id across turns", async () => {
    render(<App />);
    const user = await signIn();

    await user.type(screen.getByLabelText(/message/i), "first");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(streamCalls).toHaveLength(1));

    await user.type(screen.getByLabelText(/message/i), "second");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(streamCalls).toHaveLength(2));

    expect(streamCalls[0]?.authorization).toBe("Bearer session-token");
    expect(streamCalls[0]?.body.session_id).toBe(streamCalls[1]?.body.session_id);
  });

  it("clears the composer after sending", async () => {
    render(<App />);
    const user = await signIn();
    const input = screen.getByLabelText(/message/i);
    await user.type(input, "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("refuses to send an empty message", async () => {
    render(<App />);
    await signIn();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});

describe("failures", () => {
  it("surfaces a rate limit in plain language", async () => {
    streamStatus = 429;
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many messages/i);
  });

  it("shows an expired session message on 401", async () => {
    streamStatus = 401;
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);
  });

  it("renders the error frame emitted by the gateway", async () => {
    frames = [
      'event: error\ndata: {"code":"agent_unavailable","message":"The assistant is unavailable right now."}\n\n',
      'event: done\ndata: {"stop_reason":"error"}\n\n',
    ];
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/assistant is unavailable right now/i)).toBeInTheDocument();
    });
  });
});

describe("composer and suggestions", () => {
  it("sends a suggestion from the empty state", async () => {
    render(<App />);
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /how much data have i used/i }));
    await waitFor(() => expect(streamCalls).toHaveLength(1));
    expect(streamCalls[0]?.body.message).toBe("How much data have I used");
  });

  it("sends on Enter", async () => {
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice{Enter}");
    await waitFor(() => expect(streamCalls).toHaveLength(1));
  });

  it("keeps a new line on Shift+Enter without sending", async () => {
    render(<App />);
    const user = await signIn();
    const input = screen.getByLabelText(/message/i);
    await user.type(input, "first{Shift>}{Enter}{/Shift}second");
    expect(streamCalls).toHaveLength(0);
    expect(input).toHaveValue("first\nsecond");
  });

  it("hides the suggestions once the conversation starts", async () => {
    render(<App />);
    const user = await signIn();
    await user.type(screen.getByLabelText(/message/i), "show my invoice{Enter}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /which plans are available/i })).toBeNull();
    });
  });

  it("shows the assistant status in the header after sign-in", async () => {
    render(<App />);
    expect(screen.queryByText("online")).toBeNull();
    await signIn();
    expect(screen.getByText("online")).toBeInTheDocument();
  });
});
