# blacklist-alliance-client

Unofficial Node.js client for the [Blacklist Alliance API](https://blacklistalliance.com) - phone and email blacklist lookup for TCPA compliance.

## Installation

```bash
npm install blacklist-alliance-client
```

**Requires Node.js 18+** (uses native fetch)

## Quick Start

```javascript
const { BlacklistAlliance } = require('blacklist-alliance-client');

const client = new BlacklistAlliance('your-api-key');

// Check a single phone number
const result = await client.lookupSingle('2223334444');
if (result.message === 'Blacklisted') {
  console.log('Do not call! Reasons:', result.code);
}

// Check multiple phones (auto-batches if > 1MB)
const bulkResult = await client.bulkLookupSimple(['2223334444', '5556667777']);
console.log('Blacklisted numbers:', bulkResult.supression);
console.log('Reasons:', bulkResult.reasons);

// Check emails (supports MD5 hashing for privacy)
const emailResult = await client.emailBulk(['test@example.com'], { hashEmails: true });
console.log('Clean:', emailResult.good);
console.log('Blacklisted:', emailResult.bad);
```

## Features

- **Auto-batching**: Bulk methods automatically split large payloads (5,000 items per batch)
- **Retry with backoff**: Automatic retries with exponential backoff for transient errors
- **Circuit breaker**: Auto-disable after repeated failures to prevent cascading issues
- **Cancellation**: AbortController support for cancelling requests
- **Specific errors**: Typed error classes (RateLimitError, AuthenticationError, etc.)
- **Logging**: Optional logger interface (compatible with console, pino, winston)
- **Input validation**: Validates phone and email formats before sending
- **MD5 hashing**: Option to hash emails before sending for privacy
- **Dual API support**: Both Simple (query param) and Standard (RESTful) API styles
- **Full TypeScript support**: Bundled `.d.ts` type definitions
- **Zero dependencies**: Only uses Node.js built-ins

## API Reference

### Constructor

```javascript
const client = new BlacklistAlliance(apiKey, options);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultVersion` | string | `'v5'` | API version (v1, v2, v3, v5) |
| `timeout` | number | `30000` | Request timeout in ms (per attempt, not total) |
| `retries` | number | `3` | Number of retry attempts for failed requests |
| `logger` | object | `null` | Logger instance (console, pino, winston) |
| `dryRun` | boolean | `false` | Return mock data without making API calls |
| `onRequest` | function | `null` | Hook called before each request |
| `onResponse` | function | `null` | Hook called after each response |

#### Using a Logger

```javascript
// With console
const client = new BlacklistAlliance('your-api-key', {
  logger: console
});

// With pino
const pino = require('pino');
const client = new BlacklistAlliance('your-api-key', {
  logger: pino()
});

// Logs: debug (request start/end), warn (retries), error (failures)
```

#### Retry Behavior

The client automatically retries on:
- `5xx` server errors
- `408` timeouts
- `429` rate limits
- Network errors (ECONNRESET, etc.)

Retries use exponential backoff: 100ms → 200ms → 400ms (with jitter).

### Single Phone Lookup

#### `lookupSingle(phone, options)` - Simple API

```javascript
const result = await client.lookupSingle('2223334444');

// Response structure
{
  sid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  status: 'success',
  message: 'Blacklisted',           // or 'Good'
  code: 'prelitigation1,federal-dnc', // blacklist reason codes
  phone: '2223334444',
  wireless: 0,
  carrier: {                        // Present in v3+
    name: 'NEW CINGULAR WIRELESS PCS, LLC',
    type: 'PCS',
    state: 'CA',
    wireless: 'Y',
    // ... more carrier fields
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `'v5'` | API version |
| `responseFormat` | string | `'json'` | `'json'` or `'raw'` |
| `validate` | boolean | `true` | Validate phone format |

#### `lookup(phone, options)` - Standard RESTful API

Same as `lookupSingle` but uses the RESTful path-based endpoint.

### Bulk Phone Lookup

#### `bulkLookupSimple(phones, options)` - Simple API

Automatically batches requests if payload exceeds 1MB.

```javascript
const result = await client.bulkLookupSimple(['2223334444', '5556667777']);

// Response structure
{
  status: 'success',
  numbers: 2,                         // Total submitted
  count: 2,                           // Processed
  phones: ['2223334444', '5556667777'],
  supression: ['2223334444'],         // Blacklisted numbers (note: API uses this spelling)
  wireless: ['5556667777'],           // Wireless numbers
  reasons: {
    '2223334444': 'prelitigation1,federal-dnc'
  },
  carrier: {
    '2223334444': { name: '...', type: 'PCS', ... }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `'v5'` | API version |
| `responseFormat` | string | `'json'` | `'json'` or `'phonecode'` |
| `autoBatch` | boolean | `true` | Auto-split large payloads |

#### `bulkLookup(phones, options)` - Standard RESTful API

Same as `bulkLookupSimple` but uses the RESTful path-based endpoint.

### Email Blacklist Check

#### `emailBulk(emails, options)`

Check emails against the blacklist. Supports raw emails or MD5 hashes.

```javascript
// Send raw emails
const result = await client.emailBulk(['user@example.com']);

// Send as MD5 hashes for privacy
const result = await client.emailBulk(['user@example.com'], { hashEmails: true });

// Response structure
{
  good: ['user@example.com'],  // Not blacklisted
  bad: ['spam@example.com']    // Blacklisted
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hashEmails` | boolean | `false` | Convert emails to MD5 before sending |
| `autoBatch` | boolean | `true` | Auto-split large payloads |

### Convenience Methods

#### `isBlacklisted(phone)`

Simple boolean check.

```javascript
if (await client.isBlacklisted('9999999999')) {
  console.log('Do not call this number');
}
```

#### `isEmailBlacklisted(email, options)`

```javascript
if (await client.isEmailBlacklisted('spam@example.com')) {
  console.log('Email is blacklisted');
}

// With MD5 hashing
await client.isEmailBlacklisted('spam@example.com', { hashEmail: true });
```

#### `getBlacklistReasons(phone)`

Get array of reason codes for a blacklisted number.

```javascript
const reasons = await client.getBlacklistReasons('9999999999');
// ['prelitigation1', 'federal-dnc']
```

#### `hashEmail(email)`

Utility to hash an email to MD5.

```javascript
const hash = client.hashEmail('test@example.com');
// '55502f40dc8b7c769880b10874abc9d0'
```

## API Versions

| Version | Features |
|---------|----------|
| v1 | Basic blacklist lookup |
| v2 | Enhanced data |
| v3 | Adds carrier information |
| v5 | Latest features (default) |

## Error Handling

The library provides specific error classes for different error types:

```javascript
const {
  BlacklistAlliance,
  BlacklistAllianceError,  // Base class
  AuthenticationError,     // 401, 403
  RateLimitError,          // 429 (has retryAfter property)
  ValidationError,         // 400, 422
  TimeoutError,            // 408, request timeouts
  NetworkError,            // Connection failures
  ServerError,             // 5xx errors
} = require('blacklist-alliance-client');

try {
  const result = await client.lookupSingle('invalid');
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter} seconds`);
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof ValidationError) {
    console.log('Invalid input:', error.message);
  } else if (error instanceof BlacklistAllianceError) {
    console.log(error.statusCode, error.response);
  }
}
```

| Error Class | Status Codes | Description |
|-------------|--------------|-------------|
| `AuthenticationError` | 401, 403 | Invalid or missing API key |
| `RateLimitError` | 429 | Rate limit exceeded (check `retryAfter`) |
| `ValidationError` | 400, 422 | Invalid input parameters |
| `TimeoutError` | 408 | Request timed out |
| `NetworkError` | - | Connection failures (ECONNRESET, etc.) |
| `ServerError` | 5xx | Server-side errors |

## Cancellation

All methods support cancellation via `AbortController`:

```javascript
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const result = await client.lookupSingle('2223334444', {
    signal: controller.signal
  });
} catch (error) {
  if (error instanceof TimeoutError && error.message === 'Request aborted') {
    console.log('Request was cancelled');
  }
}
```

Aborted requests throw `TimeoutError` with message "Request aborted" and are NOT retried.

## Auto-Batching

Bulk methods automatically split large payloads to stay under the 1MB API limit:

```javascript
// Even with 100,000 phones, this works automatically
const phones = generateLotsOfPhones(); // 100k numbers
const result = await client.bulkLookupSimple(phones);
// Internally splits into batches, merges results
```

To disable auto-batching:

```javascript
const result = await client.bulkLookupSimple(phones, { autoBatch: false });
```

**Note:** Auto-batching is automatically disabled for non-JSON response formats (`phonecode`, `raw`) since these cannot be reliably merged.

### Progress Callbacks

Track progress of bulk operations:

```javascript
const result = await client.bulkLookupSimple(largePhoneList, {
  onProgress: ({ completed, total, batch, totalBatches }) => {
    console.log(`Progress: ${completed}/${total} (batch ${batch}/${totalBatches})`);
  }
});
```

## Request/Response Hooks

Intercept requests and responses for logging, metrics, or debugging:

```javascript
const client = new BlacklistAlliance('your-api-key', {
  onRequest: (url, { method, body }) => {
    console.log(`→ ${method} ${url}`);
  },
  onResponse: ({ status }, data) => {
    console.log(`← ${status}`);
  }
});
```

## Dry Run Mode

Test your integration without making actual API calls:

```javascript
const client = new BlacklistAlliance('your-api-key', {
  dryRun: true  // Returns mock data
});

const result = await client.lookupSingle('2223334444');
// Returns mock clean response without hitting the API
```

## Health Check

Verify API connectivity:

```javascript
if (await client.ping()) {
  console.log('API is reachable');
} else {
  console.log('API is down or credentials invalid');
}
```

## ESM Support

The library supports both CommonJS and ES Modules:

```javascript
// CommonJS
const { BlacklistAlliance } = require('blacklist-alliance-client');

// ES Modules
import { BlacklistAlliance } from 'blacklist-alliance-client';
// or
import BlacklistAlliance from 'blacklist-alliance-client';
```

## Circuit Breaker

Prevent cascading failures by failing fast when the API is unhealthy:

```javascript
const client = new BlacklistAlliance('your-api-key', {
  circuitBreaker: {
    failureThreshold: 5,      // Open after 5 consecutive failures
    resetTimeoutMs: 30000,    // Wait 30s before testing again
    onStateChange: (state) => {
      console.log(`Circuit breaker: ${state}`);
    }
  }
});

// After 5 failures, circuit opens
// Further requests throw CircuitBreakerError immediately (no network call)
// After 30s, circuit goes HALF_OPEN and allows 1 test request
// If test succeeds → CLOSED, if fails → OPEN for another 30s
```

**States:**
- **CLOSED** - Normal operation
- **OPEN** - Failing fast, no requests allowed
- **HALF_OPEN** - Testing if service recovered

## Changelog

### 1.1.0
- **Circuit breaker** - Automatic fault tolerance with configurable failure threshold and cooldown
- **Request/response hooks** - `onRequest` and `onResponse` callbacks for monitoring and metrics
- **Progress callbacks** - Track bulk operation progress with `onProgress`
- **AbortController support** - Cancel requests with standard `AbortSignal`
- **Dry run mode** - Test integrations without making API calls
- **Health check** - `ping()` method to verify API connectivity
- **ESM support** - Native ES module support alongside CommonJS
- **Enhanced errors** - `CircuitBreakerError`, improved `ValidationError`, `TimeoutError`, `NetworkError`

### 1.0.0
- Initial release
- Single and bulk phone lookup (Simple and Standard APIs)
- Email blacklist checking with MD5 hashing support
- Auto-batching for large payloads
- Retry with exponential backoff
- TypeScript definitions
- Convenience methods (`isBlacklisted`, `isEmailBlacklisted`, `getBlacklistReasons`)

## License

MIT
