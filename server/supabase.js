const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in server/.env');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
);

module.exports = supabase;

// Run `node supabase.js test` to check the connection
if (process.argv[2] === 'test') {
  supabase.from('complaints').select('id').limit(1).then(({ data, error }) => {
    console.log(error ? 'Connected, but: ' + error.message : 'Connected OK', data || '');
  });
}