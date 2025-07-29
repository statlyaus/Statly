// /workspaces/Statly/components/AuthForm.tsx

import React, { useState } from "react";
import { useAuth } from "../AuthContext";

const AuthForm = () => {
  const { login, signup, user, logout, loginWithGoogle } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isSignup) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || "Auth error");
    }
  };

  if (user) {
    return (
      <div className="p-4 bg-white rounded shadow text-gray-800">
        <div className="mb-2">Logged in as <b>{user.email}</b></div>
        <button
          className="bg-red-600 text-white px-4 py-2 rounded"
          onClick={logout}
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-white rounded shadow max-w-xs mx-auto">
      <h2 className="text-lg font-bold mb-2">{isSignup ? "Sign Up" : "Log In"}</h2>
      <input
        className="block w-full mb-2 px-2 py-1 border rounded"
        type="email"
        placeholder="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
      />
      <input
        className="block w-full mb-2 px-2 py-1 border rounded"
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
      />
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      <button
        className="w-full bg-blue-600 text-white py-2 rounded mb-2"
        type="submit"
      >
        {isSignup ? "Sign Up" : "Log In"}
      </button>
      <button
        type="button"
        className="w-full bg-red-600 text-white py-2 rounded mb-2"
        onClick={async () => {
          setError(null);
          try {
            await loginWithGoogle();
          } catch (err: any) {
            setError(err.message || "Google login error");
          }
        }}
      >
        Sign in with Google
      </button>
      <button
        type="button"
        className="w-full text-blue-600 underline text-sm"
        onClick={() => setIsSignup(!isSignup)}
      >
        {isSignup ? "Already have an account? Log In" : "No account? Sign Up"}
      </button>
    </form>
  );
};

export default AuthForm;