# HitPulse

A lightweight, zero-dependency HTTP load generator and latency benchmarking tool written purely in Node.js using standard standard modules.

## Features

- **Zero External Dependencies**: Powered entirely by Node's built-in `http`, `https`, `url`, and `process.hrtime` APIs.
- **Concurrent Load Testing**: Highly configurable worker pool with HTTP Keep-Alive connection pooling.
- **Sub-millisecond Precision**: High-resolution nanosecond timestamps converted into comprehensive percentile stats (Min, Mean, p50, p75, p90, p95, p99, Max).
- **Visual Terminal Output**: Real-time progress ticker, HTTP status code distribution, and an in-terminal ASCII frequency histogram.
- **JSON Output**: Easily pipeable into CI/CD pipelines and monitoring scripts with the `--json` flag.
- **Custom Requests**: Supports all standard HTTP verbs, custom headers, custom bodies, and adjustable timeout durations.

## Installation

Make the script executable and link it, or invoke directly via `node`:

```bash
chmod +x hitpulse.js
./hitpulse.js --help
```

Or place it in your `$PATH`:
```bash
mv hitpulse.js /usr/local/bin/hitpulse
```

## Usage

```bash
hitpulse <URL> [OPTIONS]
```

### Options

| Option | Description | Default |
|---|---|---|
| `-n, --requests <num>` | Total number of requests to execute | `200` |
| `-c, --concurrency <num>` | Concurrent socket connections | `10` |
| `-d, --duration <sec>` | Run benchmark for fixed seconds (overrides count) | `null` |
| `-m, --method <verb>` | HTTP request method (`GET`, `POST`, `PUT`, etc.) | `GET` |
| `-H, --header <k:v>` | Custom HTTP request header (repeatable) | - |
| `-b, --body <data>` | Request body payload string | - |
| `-t, --timeout <ms>` | Request timeout threshold in milliseconds | `10000` |
| `--json` | Output results as structured JSON | `false` |
| `-h, --help` | Display command-line usage information | - |
| `-v, --version` | Output version number | - |

### Examples

#### 1. Quick benchmark of a web server
```bash
hitpulse http://localhost:8080 -n 1000 -c 25
```

#### 2. Run for 15 seconds against an API endpoint
```bash
hitpulse https://api.example.com/health -c 50 -d 15
```

#### 3. Test a POST endpoint with payload & headers
```bash
hitpulse http://localhost:3000/api/users \
  -m POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token123" \
  -b '{"username":"benchmark_user"}' \
  -c 20 -n 500
```

#### 4. JSON Output for automated tests
```bash
hitpulse https://httpbin.org/get -n 50 -c 5 --json
```

## License

MIT