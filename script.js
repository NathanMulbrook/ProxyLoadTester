import http from 'k6/http';
import { check, sleep } from 'k6';

// Load targets from a JSON list. Provide many hosts to exercise DNS/cache paths in Squid.
const targets = JSON.parse(open('./targets.json'));

// Fraction of iterations that should keep connections alive.
const LONG_LIVED_RATIO = 0.3;

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
