import { supabase } from "@/lib/supabaseClient";

export const ADMIN_ROLE_VALUE = 1;

export function isAdminRole(role) {
  return Number(role) === ADMIN_ROLE_VALUE;
}

export async function getUserRole(userId) {
  if (!supabase || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.role ?? null;
}
