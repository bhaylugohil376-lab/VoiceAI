
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const authOptions = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false
};

let supabase = null;
let supabaseAdmin = null;

// Public client: user authentication and session verification
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: { ...authOptions }
    }
  );
}

// Admin client: trusted server-side database operations
if (supabaseUrl && supabaseServiceRoleKey) {
  supabaseAdmin = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: { ...authOptions }
    }
  );
}

// Return the public client or report missing configuration
export function getSupabasePublic() {
  if (!supabase) {
    throw new Error(
      "Supabase public client is not configured. Check SUPABASE_URL and SUPABASE_ANON_KEY."
    );
  }

  return supabase;
}

// Return the admin client or report missing server configuration
export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error(
      "Supabase admin client is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return supabaseAdmin;
}

// Named exports for files that use these clients directly
export { supabase, supabaseAdmin };

// Default export for compatibility with default imports
export default supabaseAdmin;
