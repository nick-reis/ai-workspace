import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  error: string | null;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
