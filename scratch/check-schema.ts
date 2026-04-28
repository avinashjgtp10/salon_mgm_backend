import pool from '../src/config/database';

async function checkSchema() {
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'payments';
    `);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
