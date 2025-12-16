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
- **Logging**: Optional logger interface (compatible with console, pino, winston)
- **Phone validation**: Validates phone number format before sending
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
  message: 'Blacklisted',           // or 'Clean'
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

```javascript
const { BlacklistAlliance, BlacklistAllianceError } = require('blacklist-alliance-client');

try {
  const result = await client.lookupSingle('invalid');
} catch (error) {
  if (error instanceof BlacklistAllianceError) {
    console.log(error.statusCode); // HTTP status code
    console.log(error.response);   // Raw API response
  }
}
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad input parameter |
| 403 | Invalid API key |
| 408 | Request timeout |
| 422 | Invalid phone number |

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

## License

MIT
