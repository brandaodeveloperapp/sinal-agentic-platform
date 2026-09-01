import { useCallback, useState } from "react";

import { ApiError, login as loginRequest } from "../api/client.js";
import type { AuthenticatedUser } from "../types.js";

export interface AuthState {
  user: AuthenticatedUser | null;
  token: string | null;
  pending: boolean;
  error: string | null;
}

/**
 * Keeps the session token in memory only.
 *
 * Nothing is written to localStorage or sessionStorage, so a script injected into
 * the page has no persisted credential to read and closing the tab ends the
 * session. The tradeoff is deliberate: a page reload asks for sign-in again.
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    pending: false,
    error: null,
  });

  const signIn = useCallback(async (username: string, password: string) => {
    setState((current) => ({ ...current, pending: true, error: null }));
    try {
      const result = await loginRequest(username, password);
      setState({ user: result.user, token: result.accessToken, pending: false, error: null });
      return true;
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Sign-in failed. Try again in a moment.";
      setState({ user: null, token: null, pending: false, error: message });
      return false;
    }
  }, []);

  const signOut = useCallback(() => {
    setState({ user: null, token: null, pending: false, error: null });
  }, []);

  return { ...state, signIn, signOut };
}
