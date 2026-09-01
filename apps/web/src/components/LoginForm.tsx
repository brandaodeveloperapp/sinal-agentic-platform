import { useState, type FormEvent } from "react";

import { BrandMark } from "./BrandMark.js";

interface LoginFormProps {
  pending: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
}

export function LoginForm({ pending, error, onSubmit }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(username, password);
  }

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-brand__top">
          <BrandMark size={30} />
          <span>Onda Telecom</span>
        </div>

        <div className="auth-brand__copy">
          <h2>Your account, answered in one conversation.</h2>
          <p>
            Plans, data usage, invoices and support tickets — the assistant reads them from the
            systems you are entitled to, and nothing else.
          </p>
        </div>

        <div className="auth-brand__facts">
          <span>Every answer comes from a corporate system, never from memory</span>
          <span>You only ever see the capabilities your account allows</span>
        </div>
      </aside>

      <main className="auth-form">
        <form onSubmit={handleSubmit} aria-labelledby="login-title">
          <h1 id="login-title">Onda Telecom</h1>
          <p className="muted">Sign in to talk to the assistant.</p>

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              placeholder="marina"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error ? (
            <p className="alert" role="alert">
              {error}
            </p>
          ) : null}

          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>

          <div className="auth-hint">
            <span>Demo accounts</span>
            <span>
              <code>marina</code> · <code>rafael</code> subscribers, <code>agent-smith</code>{" "}
              support desk
            </span>
            <span>
              Password <code>demo1234</code>
            </span>
          </div>
        </form>
      </main>
    </div>
  );
}
