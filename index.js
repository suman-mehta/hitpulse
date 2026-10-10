#!/usr/bin/env node

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { hrtime } = require('process');

const VERSION = '1.0.0';
const isTTY = Boolean(process.stdout.isTTY && !process.env.CI);

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  clearLine: '\x1b[2K\r'
};

function showHelp() {
  console.log(`
${ANSI.bold}${ANSI.cyan}HitPulse${ANSI.reset} v${VERSION} - Zero-dependency HTTP Benchmarking Tool

${ANSI.bold}USAGE:${ANSI.reset}
  hitpulse <URL> [OPTIONS]

${ANSI.bold}OPTIONS:${ANSI.reset}
  -n, --requests <num>     Total number of requests (default: 200)
  -c, --concurrency <num>  Number of concurrent connections (default: 10)
  -d, --duration <sec>     Max benchmark duration in seconds (overrides count)
  -m, --method <verb>      HTTP method [GET, POST, PUT, DELETE, etc.] (default: GET)
  -H, --header <key:val>   Custom header (can be used multiple times)
  -b, --body <data>        Request payload string
  -t, --timeout <ms>       Request timeout in ms (default: 10000)
  --json                   Output results in raw JSON
  -h, --help               Display this help text
  -v, --version            Display version

${ANSI.bold}EXAMPLES:${ANSI.reset}
  hitpulse https://httpbin.org/get -c 20 -n 500
  hitpulse http://localhost:3000/api -c 50 -d 15
  hitpulse http://localhost:8080/data -m POST -H "Content-Type: application/json" -b '{"test":1}'
`);
  process.exit(0);
}

function parseArgs(args) {
  const config = {
    url: null,
    requests: 200,
    concurrency: 10,
    duration: null,
    method: 'GET',
    headers: {},
    body: null,
    timeout: 10000,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') showHelp();
    if (arg === '-v' || arg === '--version') {
      console.log(`hitpulse v${VERSION}`);
      process.exit(0);
    }
    if (arg === '--json') {
      config.json = true;
      continue;
    }
    if (arg === '-n' || arg === '--requests') {
      config.requests = parseInt(args[++i], 10) || 200;
      continue;
    }
    if (arg === '-c' || arg === '--concurrency') {
      config.concurrency = Math.max(1, parseInt(args[++i], 10) || 10);
      continue;
    }
    if (arg === '-d' || arg === '--duration') {
      config.duration = parseFloat(args[++i]);
      continue;
    }
    if (arg === '-m' || arg === '--method') {
      config.method = (args[++i] || 'GET').toUpperCase();
      continue;
    }
    if (arg === '-t' || arg === '--timeout') {
      config.timeout = parseInt(args[++i], 10) || 10000;
      continue;
    }
    if (arg === '-b' || arg === '--body') {
      config.body = args[++i];
      continue;
    }
    if (arg === '-H' || arg === '--header') {
      const headerLine = args[++i] || '';
      const splitIdx = headerLine.indexOf(':');
      if (splitIdx > 0) {
        const key = headerLine.slice(0, splitIdx).trim();
        const val = headerLine.slice(splitIdx + 1).trim();
        config.headers[key] = val;
      }
      continue;
    }
    if (!arg.startsWith('-') && !config.url) {
      config.url = arg;
    }
  }

  return config;
}

function calculateStats(latencies) {
  if (latencies.length === 0) return null;
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const count = latencies.length;
  const getP = (p) => latencies[Math.min(Math.floor((p / 100) * count), count - 1)];

  return {
    min: latencies[0],
    max: latencies[count - 1],
    mean: sum / count,
    p50: getP(50),
    p75: getP(75),
    p90: getP(90),
    p95: getP(95),
    p99: getP(99)
  };
}

function drawHistogram(latencies, bins = 7) {
  if (latencies.length === 0) return '';
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  if (min === max) return `  ${min.toFixed(2)} ms [${latencies.length}]`;

  const binWidth = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const lat of latencies) {
    let b = Math.floor((lat - min) / binWidth);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }

  const maxCount = Math.max(...counts);
  const barMaxWidth = 30;
  let out = '';

  for (let i = 0; i < bins; i++) {
    const bStart = (min + i * binWidth).toFixed(1);
    const bEnd = (min + (i + 1) * binWidth).toFixed(1);
    const count = counts[i];
    const barLen = maxCount > 0 ? Math.round((count / maxCount) * barMaxWidth) : 0;
    const bar = '■'.repeat(barLen) + ' '.repeat(barMaxWidth - barLen);
    const label = `${bStart.padStart(6)} - ${bEnd.padStart(6)} ms`;
    out += `  ${ANSI.dim}${label}${ANSI.reset} | ${ANSI.cyan}${bar}${ANSI.reset} | ${ANSI.bold}${count}${ANSI.reset}\n`;
  }
  return out;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function run() {
  const config = parseArgs(process.argv.slice(2));

  if (!config.url) {
    console.error(`${ANSI.red}Error:${ANSI.reset} Target URL is required.`);
    showHelp();
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(config.url);
  } catch (err) {
    console.error(`${ANSI.red}Error:${ANSI.reset} Invalid URL provided: ${config.url}`);
    process.exit(1);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    console.error(`${ANSI.red}Error:${ANSI.reset} Only http: and https: protocols are supported.`);
    process.exit(1);
  }

  const isHttps = parsedUrl.protocol === 'https:';
  const agentOptions = {
    keepAlive: true,
    maxSockets: config.concurrency,
    timeout: config.timeout
  };
  const agent = isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);

  const headers = { ...config.headers };
  if (config.body && !headers['Content-Length'] && !headers['content-length']) {
    headers['Content-Length'] = Buffer.byteLength(config.body);
  }
  if (!headers['User-Agent'] && !headers['user-agent']) {
    headers['User-Agent'] = `HitPulse/${VERSION}`;
  }

  const latencies = [];
  const statusCodes = {};
  let errors = 0;
  let totalBytes = 0;
  let completed = 0;
  let started = 0;

  const startTime = hrtime.bigint();
  const durationLimitMs = config.duration ? config.duration * 1000 : null;
  let abortTest = false;

  process.on('SIGINT', () => {
    abortTest = true;
    if (!config.json) {
      console.log(`\n${ANSI.yellow}Interrupted by user. Calculating results...${ANSI.reset}`);
    }
  });

  if (!config.json) {
    console.log(`\n${ANSI.bold}${ANSI.cyan}⚡ HitPulse Benchmark${ANSI.reset}`);
    console.log(`  Target:       ${ANSI.bold}${config.url}${ANSI.reset}`);
    console.log(`  Concurrency:  ${config.concurrency}`);
    console.log(`  Mode:         ${durationLimitMs ? `${config.duration}s duration` : `${config.requests} requests`}`);
    console.log(`  Method:       ${config.method}\n`);
  }

  function shouldStop() {
    if (abortTest) return true;
    if (durationLimitMs) {
      const elapsedMs = Number(hrtime.bigint() - startTime) / 1e6;
      return elapsedMs >= durationLimitMs;
    }
    return started >= config.requests;
  }

  function dispatchRequest() {
    return new Promise((resolve) => {
      if (shouldStop()) return resolve(false);
      started++;

      let settled = false;
      const done = (isSuccess) => {
        if (settled) return;
        settled = true;
        if (isSuccess) {
          completed++;
        } else {
          errors++;
        }
        resolve(true);
      };

      const reqStart = hrtime.bigint();
      const reqOpts = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: config.method,
        headers,
        agent,
        timeout: config.timeout
      };

      const client = isHttps ? https : http;
      const req = client.request(reqOpts, (res) => {
        let resBytes = 0;
        res.on('data', (chunk) => {
          resBytes += chunk.length;
        });
        res.on('end', () => {
          const reqEnd = hrtime.bigint();
          const latencyMs = Number(reqEnd - reqStart) / 1e6;
          latencies.push(latencyMs);
          statusCodes[res.statusCode] = (statusCodes[res.statusCode] || 0) + 1;
          totalBytes += resBytes;
          done(true);
        });
        res.on('error', () => {
          done(false);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        done(false);
      });

      req.on('error', () => {
        done(false);
      });

      if (config.body) {
        req.write(config.body);
      }
      req.end();
    });
  }

  let progressTimer = null;
  if (isTTY && !config.json) {
    progressTimer = setInterval(() => {
      const now = hrtime.bigint();
      const elapsedSec = Number(now - startTime) / 1e9;
      const totalHandled = completed + errors;
      const rate = elapsedSec > 0 ? (totalHandled / elapsedSec).toFixed(1) : 0;
      const progressMsg = durationLimitMs
        ? `${elapsedSec.toFixed(1)}s / ${config.duration}s`
        : `${totalHandled} / ${config.requests} (${Math.round((totalHandled / config.requests) * 100) || 0}%)`;
      process.stdout.write(
        `${ANSI.clearLine}  [Running] Completed: ${ANSI.bold}${progressMsg}${ANSI.reset} | RPS: ${ANSI.green}${rate}${ANSI.reset} | Errors: ${errors > 0 ? ANSI.red : ANSI.dim}${errors}${ANSI.reset}`
      );
    }, 100);
  }

  async function worker() {
    while (!shouldStop()) {
      const continueLoop = await dispatchRequest();
      if (!continueLoop) break;
    }
  }

  const workers = Array.from({ length: config.concurrency }, () => worker());
  await Promise.all(workers);

  if (progressTimer) {
    clearInterval(progressTimer);
    process.stdout.write(ANSI.clearLine);
  }

  const totalDurationSec = Number(hrtime.bigint() - startTime) / 1e9;
  const totalHandled = completed + errors;
  const rps = totalDurationSec > 0 ? totalHandled / totalDurationSec : 0;
  const stats = calculateStats(latencies);

  agent.destroy();

  if (config.json) {
    const output = {
      url: config.url,
      totalRequests: totalHandled,
      successfulRequests: completed,
      failedRequests: errors,
      durationSeconds: parseFloat(totalDurationSec.toFixed(3)),
      requestsPerSecond: parseFloat(rps.toFixed(2)),
      bytesTransferred: totalBytes,
      statusCodes,
      latencyMs: stats
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`${ANSI.bold}Summary:${ANSI.reset}`);
  console.log(`  Successful Requests:  ${ANSI.bold}${completed}${ANSI.reset}`);
  console.log(`  Failed Requests:      ${errors > 0 ? ANSI.red : ANSI.dim}${errors}${ANSI.reset}`);
  console.log(`  Duration:             ${totalDurationSec.toFixed(2)} seconds`);
  console.log(`  Requests / Second:    ${ANSI.bold}${ANSI.green}${rps.toFixed(2)}${ANSI.reset}`);
  console.log(`  Data Transferred:     ${formatBytes(totalBytes)}\n`);

  if (Object.keys(statusCodes).length > 0) {
    console.log(`${ANSI.bold}Status Codes:${ANSI.reset}`);
    for (const [code, count] of Object.entries(statusCodes)) {
      const color = code.startsWith('2') ? ANSI.green : code.startsWith('3') ? ANSI.cyan : code.startsWith('4') ? ANSI.yellow : ANSI.red;
      console.log(`  [${color}${code}${ANSI.reset}] : ${count}`);
    }
    console.log('');
  }

  if (stats) {
    console.log(`${ANSI.bold}Latency Distribution:${ANSI.reset}`);
    console.log(`  Min:      ${stats.min.toFixed(2)} ms`);
    console.log(`  Mean:     ${stats.mean.toFixed(2)} ms`);
    console.log(`  p50 (Med):${stats.p50.toFixed(2)} ms`);
    console.log(`  p75:      ${stats.p75.toFixed(2)} ms`);
    console.log(`  p90:      ${stats.p90.toFixed(2)} ms`);
    console.log(`  p95:      ${stats.p95.toFixed(2)} ms`);
    console.log(`  p99:      ${stats.p99.toFixed(2)} ms`);
    console.log(`  Max:      ${stats.max.toFixed(2)} ms\n`);

    console.log(`${ANSI.bold}Histogram:${ANSI.reset}`);
    console.log(drawHistogram(latencies));
  } else {
    console.log(`${ANSI.yellow}No successful response timings collected.${ANSI.reset}\n`);
  }
}

run().catch((err) => {
  console.error(`${ANSI.red}Fatal Execution Error:${ANSI.reset}`, err.message);
  process.exit(1);
});