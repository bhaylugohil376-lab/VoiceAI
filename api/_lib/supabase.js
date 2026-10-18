const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Warning: Missing Supabase URL or Service Role Key in environment variables.');
}

// Client for standard public requests with RLS
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client bypassing RLS for server-side usage logging & billing sync
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

module.exports = { supabase, supabaseAdmin };
