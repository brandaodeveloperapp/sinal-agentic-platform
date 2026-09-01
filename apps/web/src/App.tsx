import { ChatView } from "./components/ChatView.js";
import { LoginForm } from "./components/LoginForm.js";
import { useAuth } from "./hooks/useAuth.js";

export function App() {
  const auth = useAuth();

  if (!auth.token || !auth.user) {
    return <LoginForm pending={auth.pending} error={auth.error} onSubmit={auth.signIn} />;
  }

  return <ChatView user={auth.user} token={auth.token} onSignOut={auth.signOut} />;
}
