import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/types/database.generated";

const supabaseEnvironmentSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

const environment = supabaseEnvironmentSchema.safeParse(import.meta.env);

if (!environment.success) {
  throw new Error(
    "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.",
  );
}

export const supabase = createClient<Database>(
  environment.data.VITE_SUPABASE_URL,
  environment.data.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
    },
  },
);
