import http from 'k6/http';
import { check, sleep } from 'k6';

// Load targets from a JSON list. Provide many hosts to exercise DNS/cache paths in Squid.
const targets = JSON.parse(open('./targets.json'));

// Fraction of iterations that should keep connections alive.
const LONG_LIVED_RATIO = 0.3;
// Proxy endpoint: use env if provided; fallback to on-prem proxy.
const DEFAULT_PROXY = 'http://199.100.16.100:3128';
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

export default function () {
  const proxyConfigured = __ENV.K6_HTTP_PROXY || __ENV.K6_HTTPS_PROXY;
  if (!proxyConfigured && !proxyWarned) {
    console.warn(`Proxy not set; export K6_HTTP_PROXY and K6_HTTPS_PROXY (e.g., ${DEFAULT_PROXY})`);
    proxyWarned = true;
  }

  const url = targets[Math.floor(Math.random() * targets.length)];
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

  const res = http.get(url, params);

  check(res, {
    'status is 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
  });

  // Add pacing to keep per-VU RPS moderate while the arrival-rate executor caps total RPS.
  sleep(longLived ? 0.8 : 0.2);
}
