const { Client } = require('pg');

async function main() {
  const password = 'admin2702'; // from .env.local

  const client = new Client({
    host: 'salonox-postgres-db.c6hws8q64mj9.us-east-1.rds.amazonaws.com',
    port: 5432,
    database: 'salonoxdb',
    user: 'postgres',
    password,
    ssl: {
      rejectUnauthorized: false,
      ca: require('fs').readFileSync('./global-bundle.pem').toString()
    }
  });

  try {
    await client.connect();
    const res = await client.query('SELECT version()');
    console.log('✅ Connected! PostgreSQL version:');
    console.log(res.rows[0].version);
  } catch (error) {
    console.error('❌ Database error:', error.message);
  } finally {
    await client.end();
  }
}

main();
