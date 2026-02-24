import http from 'k6/http';
import { check, sleep } from 'k6';

// Load targets from a JSON list. Provide many hosts to exercise DNS/cache paths in Squid.
const targets = JSON.parse(open('./targets.json'));

// Fraction of iterations that should keep connections alive.
const LONG_LIVED_RATIO = 0.3;
// Proxy endpoint: use env if provided; fallback to on-prem proxy.
const DEFAULT_PROXY = 'http://199.100.16.100:3128';
let proxyWarned = false;
const LOG_EVERY = Number(__ENV.LOG_EVERY || 1); // default to log every iteration for live latency
const RUN_AVG_EVERY = Number(__ENV.RUN_AVG_EVERY || 50); // print running average every N iterations
let aggCount = 0;
let aggDurationMs = 0;
// k6 allows setting env vars at runtime; this ensures proxy is set even if the shell didn't export it.
if (!__ENV.K6_HTTP_PROXY && !__ENV.HTTP_PROXY) {
  __ENV.K6_HTTP_PROXY = DEFAULT_PROXY;
  __ENV.HTTP_PROXY = DEFAULT_PROXY;
}
if (!__ENV.K6_HTTPS_PROXY && !__ENV.HTTPS_PROXY) {
  __ENV.K6_HTTPS_PROXY = DEFAULT_PROXY;
  __ENV.HTTPS_PROXY = DEFAULT_PROXY;
}

export const options = {
  insecureSkipTLSVerify: false, // enforce TLS validation; proxy is not intercepting
  scenarios: {
    steady_load: {
      executor: 'constant-arrival-rate',
      rate: 400, // target requests per second; tune up/down as needed
      timeUnit: '1s',
      duration: '30m',
      preAllocatedVUs: 60,
      maxVUs: 300, // cap active users to avoid DoS-like surges
      gracefulStop: '30s',
    },
  },
  discardResponseBodies: true,
};

function pickUrl() {
  const raw = targets[Math.floor(Math.random() * targets.length)];
  if (!raw) return null;
  // Force http to improve proxy compatibility; many top-1M entries lack HTTPS.
  if (raw.startsWith('https://')) return raw.replace(/^https:/i, 'http:');
  if (raw.startsWith('http://')) return raw;
  return `http://${raw}`;
}

export default function () {
  const proxyConfigured = __ENV.K6_HTTP_PROXY || __ENV.K6_HTTPS_PROXY;
  if (!proxyConfigured && !proxyWarned) {
    console.warn(`Proxy not set; export K6_HTTP_PROXY and K6_HTTPS_PROXY (e.g., ${DEFAULT_PROXY})`);
    proxyWarned = true;
  }

  const url = pickUrl();
  if (!url) {
    console.error('No targets available');
    sleep(1);
    return;
  }
  const longLived = Math.random() < LONG_LIVED_RATIO;

  const params = longLived
    ? {
        headers: { 'User-Agent': 'k6-long-lived' },
        timeout: '10s',
        // keepalive is default true; this path keeps sockets around
      }
    : {
        headers: { 'User-Agent': 'k6-short-lived', Connection: 'close' },
        timeout: '5s',
      };

  let res;
  try {
    res = http.get(url, params);
  } catch (err) {
    if (LOG_EVERY) {
      console.warn(`request error for ${url}: ${err}`);
    }
    sleep(longLived ? 0.8 : 0.2);
    return;
  }

  check(res, {
    'status is 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
  });

  if (LOG_EVERY && (__ITER % LOG_EVERY === 0)) {
    console.log(`iter ${__ITER} ${url} status=${res.status} dur=${res.timings.duration.toFixed(1)}ms`);
  }

  // Accumulate and periodically print running average latency for readability.
  aggCount += 1;
  aggDurationMs += res.timings.duration;
  if (RUN_AVG_EVERY && aggCount % RUN_AVG_EVERY === 0) {
    const avg = aggDurationMs / aggCount;
    console.log(`avg over ${aggCount} reqs: ${avg.toFixed(1)}ms`);
  }

  // Add pacing to keep per-VU RPS moderate while the arrival-rate executor caps total RPS.
  sleep(longLived ? 0.8 : 0.2);
}
