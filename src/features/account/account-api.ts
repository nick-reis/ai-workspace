import { supabase } from "@/lib/supabase";

export async function signOutCurrentDevice() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error(error.message);
}

export async function deleteWorkspaceData() {
  const { data, error } = await supabase.rpc("reset_workspace_data", {
    p_confirmation: "RESET",
  });
  if (error) throw new Error(error.message);
  return data;
}
