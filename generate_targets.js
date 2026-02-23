// Fetch a public top-sites list and build targets.json for k6.
// Usage: node generate_targets.js [count]
// Optionally set TARGET_COUNT env var (default 500).

const fs = require('fs');
const https = require('https');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'targets.json');
const SOURCE_URL = 'https://raw.githubusercontent.com/opendns/public-domain-lists/master/opendns-top-1m.csv';
const DEFAULT_COUNT = 500;

const countArg = Number.parseInt(process.argv[2], 10);
const targetCount = Number.isFinite(countArg) ? countArg : Number.parseInt(process.env.TARGET_COUNT, 10) || DEFAULT_COUNT;

function fetchList(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching list`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function buildTargets(csv, limit) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const targets = [];
  for (const line of lines) {
    if (targets.length >= limit) break;
    const parts = line.split(',');
    const domain = parts.length > 1 ? parts[1].trim() : parts[0].trim();
    if (!domain) continue;
    targets.push(`https://${domain}/`);
  }
  return targets;
}

async function main() {
  console.log(`Downloading list from ${SOURCE_URL} ...`);
  const csv = await fetchList(SOURCE_URL);
  const targets = buildTargets(csv, targetCount);
  if (!targets.length) throw new Error('No targets parsed');
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(targets, null, 2));
  console.log(`Wrote ${targets.length} targets to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('Failed to generate targets:', err.message || err);
  process.exitCode = 1;
});
