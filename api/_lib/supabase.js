
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

let supabaseAdmin = null;
let supabasePublic = null;

if (supabaseUrl && serviceRoleKey) {
  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

if (supabaseUrl && anonKey) {
  supabasePublic = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error(
      "Supabase admin is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return supabaseAdmin;
}

export function getSupabasePublic() {
  if (!supabasePublic) {
    throw new Error(
      "Supabase public client is not configured. Check SUPABASE_URL and SUPABASE_ANON_KEY."
    );
  }

  return supabasePublic;
}

export default supabaseAdmin;
