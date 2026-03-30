const { Pool } = require('pg');

// Using purely pg, connecting via standard DATABASE_URL
// This is equally prepared for Supabase or a local Docker DB.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/cmms_db',
    /*
     * Uncomment specific SSL options if needed for Supabase string format
     * ssl: {
     *   rejectUnauthorized: false
     * }
     */
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};
