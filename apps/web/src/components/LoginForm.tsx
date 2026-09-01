import { useState, type FormEvent } from "react";

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
    <main className="login">
      <form className="card" onSubmit={handleSubmit} aria-labelledby="login-title">
        <h1 id="login-title">Onda Telecom</h1>
        <p className="muted">Sign in to talk to the assistant.</p>

        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
