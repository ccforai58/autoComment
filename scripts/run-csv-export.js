require('dotenv').config();

const csvBatches = require('../api/csv-batches');

async function main() {
  const maxBatches = Number(process.argv[2] || process.env.CSV_EXPORT_MAX_BATCHES_PER_RUN || 20);
  const result = await csvBatches.runExportJob({ maxBatches });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[run-csv-export] failed:', error);
  process.exitCode = 1;
});
