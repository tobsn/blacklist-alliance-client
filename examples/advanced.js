/**
 * Advanced usage examples for blacklist-alliance-client
 *
 * Demonstrates: logging, hooks, progress callbacks, cancellation, dry run, error handling
 *
 * Run with: BLACKLIST_API_KEY=your-key node examples/advanced.js
 */

const {
  BlacklistAlliance,
  BlacklistAllianceError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  TimeoutError,
  CircuitBreakerError,
} = require('../src');

const API_KEY = process.env.BLACKLIST_API_KEY;

if (!API_KEY) {
  console.error('Please set BLACKLIST_API_KEY environment variable');
  process.exit(1);
}

// Simple custom logger
const customLogger = {
  debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta || ''),
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
};

async function main() {
  // ===============================================
  // Example 1: Client with hooks for metrics
  // ===============================================
  console.log('\n=== Request/Response Hooks ===\n');

  let requestCount = 0;
  const client = new BlacklistAlliance(API_KEY, {
    logger: customLogger,
    onRequest: (url, { method }) => {
      requestCount++;
      console.log(`→ [${requestCount}] ${method} ${url.split('?')[0]}`);
    },
    onResponse: ({ status }, data) => {
      console.log(`← [${requestCount}] Status: ${status}`);
    }
  });

  try {
    await client.lookupSingle('5551234567');
  } catch (e) {
    console.log('Request completed (may have failed - that\'s ok for demo)');
  }

  // ===============================================
  // Example 2: Bulk lookup with progress
  // ===============================================
  console.log('\n=== Bulk Lookup with Progress ===\n');

  const phones = Array.from({ length: 100 }, (_, i) =>
    `555${String(i).padStart(7, '0')}`
  );

  try {
    const result = await client.bulkLookupSimple(phones, {
      onProgress: ({ completed, total, batch, totalBatches }) => {
        const pct = Math.round((completed / total) * 100);
        console.log(`Progress: ${pct}% (${completed}/${total}) - Batch ${batch}/${totalBatches}`);
      }
    });
    console.log(`\nResults: ${result.supression?.length || 0} blacklisted`);
  } catch (error) {
    console.error('Bulk lookup failed:', error.message);
  }

  // ===============================================
  // Example 3: Cancellation with AbortController
  // ===============================================
  console.log('\n=== Cancellable Request ===\n');

  const controller = new AbortController();

  // Cancel after 100ms
  setTimeout(() => {
    console.log('Aborting request...');
    controller.abort();
  }, 100);

  try {
    await client.lookupSingle('5559999999', { signal: controller.signal });
    console.log('Request completed');
  } catch (error) {
    if (error instanceof TimeoutError && error.message === 'Request aborted') {
      console.log('Request was cancelled as expected');
    } else {
      console.log('Request failed:', error.message);
    }
  }

  // ===============================================
  // Example 4: Dry Run Mode
  // ===============================================
  console.log('\n=== Dry Run Mode ===\n');

  const dryRunClient = new BlacklistAlliance('fake-key', {
    dryRun: true,
    logger: customLogger
  });

  const mockResult = await dryRunClient.lookupSingle('5551234567');
  console.log('Dry run result:', mockResult);
  console.log('(No actual API call was made)');

  // ===============================================
  // Example 5: Health Check
  // ===============================================
  console.log('\n=== Health Check ===\n');

  const isHealthy = await client.ping();
  console.log(`API Status: ${isHealthy ? 'Healthy' : 'Unhealthy'}`);

  // ===============================================
  // Example 6: Typed Error Handling
  // ===============================================
  console.log('\n=== Typed Error Handling ===\n');

  const testClient = new BlacklistAlliance('invalid-key', { retries: 0 });

  try {
    await testClient.lookupSingle('5551234567');
  } catch (error) {
    if (error instanceof AuthenticationError) {
      console.log('Authentication failed - check your API key');
    } else if (error instanceof RateLimitError) {
      console.log(`Rate limited - retry after ${error.retryAfter} seconds`);
    } else if (error instanceof ValidationError) {
      console.log('Invalid input:', error.message);
    } else if (error instanceof BlacklistAllianceError) {
      console.log(`API Error [${error.statusCode}]:`, error.message);
    } else {
      console.log('Unknown error:', error);
    }
  }

  // ===============================================
  // Example 7: Email hashing for privacy
  // ===============================================
  console.log('\n=== Email MD5 Hashing ===\n');

  const emails = ['user@example.com', 'test@test.com'];
  console.log('Original emails:');
  emails.forEach(e => console.log(`  ${e} -> ${client.hashEmail(e)}`));

  try {
    const result = await client.emailBulk(emails, { hashEmails: true });
    console.log(`\nClean: ${result.good?.length || 0}, Blacklisted: ${result.bad?.length || 0}`);
  } catch (error) {
    console.error('Email check failed:', error.message);
  }

  // ===============================================
  // Example 8: Circuit Breaker for fault tolerance
  // ===============================================
  console.log('\n=== Circuit Breaker ===\n');

  const cbClient = new BlacklistAlliance('invalid-key-to-trigger-failures', {
    retries: 0,
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      onStateChange: (state) => {
        console.log(`Circuit breaker state: ${state}`);
      }
    }
  });

  console.log('Simulating failures to open circuit...');

  // Trigger failures to open the circuit
  for (let i = 1; i <= 4; i++) {
    try {
      await cbClient.lookupSingle('5551234567');
    } catch (error) {
      console.log(`Request ${i}: ${error.name} - ${error.message.substring(0, 50)}...`);
    }
  }

  console.log('\nCircuit breaker is now OPEN - requests fail fast without hitting API');
}

main().catch(console.error);
