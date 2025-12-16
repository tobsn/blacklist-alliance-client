const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  BlacklistAlliance,
  BlacklistAllianceError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  TimeoutError,
  NetworkError,
  ServerError,
  CircuitBreakerError,
} = require('../src');

describe('BlacklistAlliance', () => {
  describe('constructor', () => {
    it('should throw if no API key provided', () => {
      assert.throws(() => new BlacklistAlliance(), /API key is required/);
    });

    it('should create client with defaults', () => {
      const client = new BlacklistAlliance('test-key');
      assert.strictEqual(client.apiKey, 'test-key');
      assert.strictEqual(client.defaultVersion, 'v5');
      assert.strictEqual(client.timeout, 30000);
    });

    it('should accept custom options', () => {
      const client = new BlacklistAlliance('test-key', {
        defaultVersion: 'v3',
        timeout: 5000,
      });
      assert.strictEqual(client.defaultVersion, 'v3');
      assert.strictEqual(client.timeout, 5000);
    });
  });

  describe('phone validation', () => {
    it('should accept valid 10-digit phone', () => {
      const client = new BlacklistAlliance('test-key');
      const cleaned = client._validatePhone('2223334444');
      assert.strictEqual(cleaned, '2223334444');
    });

    it('should strip non-digits', () => {
      const client = new BlacklistAlliance('test-key');
      const cleaned = client._validatePhone('(222) 333-4444');
      assert.strictEqual(cleaned, '2223334444');
    });

    it('should accept 11-digit phone', () => {
      const client = new BlacklistAlliance('test-key');
      const cleaned = client._validatePhone('12223334444');
      assert.strictEqual(cleaned, '12223334444');
    });

    it('should reject short phone numbers', () => {
      const client = new BlacklistAlliance('test-key');
      assert.throws(
        () => client._validatePhone('123'),
        /Invalid phone number/
      );
    });
  });

  describe('email hashing', () => {
    it('should hash email to MD5', () => {
      const client = new BlacklistAlliance('test-key');
      const hash = client.hashEmail('test@example.com');
      assert.strictEqual(hash, '55502f40dc8b7c769880b10874abc9d0');
    });

    it('should normalize email before hashing', () => {
      const client = new BlacklistAlliance('test-key');
      const hash1 = client.hashEmail('TEST@EXAMPLE.COM');
      const hash2 = client.hashEmail('test@example.com');
      assert.strictEqual(hash1, hash2);
    });

    it('should trim whitespace', () => {
      const client = new BlacklistAlliance('test-key');
      const hash1 = client.hashEmail('  test@example.com  ');
      const hash2 = client.hashEmail('test@example.com');
      assert.strictEqual(hash1, hash2);
    });
  });

  describe('email validation', () => {
    it('should accept valid email', () => {
      const client = new BlacklistAlliance('test-key');
      const result = client._validateEmail('test@example.com');
      assert.strictEqual(result, 'test@example.com');
    });

    it('should trim whitespace from email', () => {
      const client = new BlacklistAlliance('test-key');
      const result = client._validateEmail('  test@example.com  ');
      assert.strictEqual(result, 'test@example.com');
    });

    it('should reject email without @', () => {
      const client = new BlacklistAlliance('test-key');
      assert.throws(
        () => client._validateEmail('testexample.com'),
        /Invalid email format/
      );
    });

    it('should reject email without domain', () => {
      const client = new BlacklistAlliance('test-key');
      assert.throws(
        () => client._validateEmail('test@'),
        /Invalid email format/
      );
    });

    it('should reject email without TLD', () => {
      const client = new BlacklistAlliance('test-key');
      assert.throws(
        () => client._validateEmail('test@example'),
        /Invalid email format/
      );
    });

    it('should throw ValidationError for invalid email', () => {
      const client = new BlacklistAlliance('test-key');
      assert.throws(
        () => client._validateEmail('invalid'),
        (err) => err instanceof ValidationError && err.statusCode === 422
      );
    });
  });

  describe('batching', () => {
    it('should not batch small payloads', () => {
      const client = new BlacklistAlliance('test-key');
      const phones = ['1234567890', '0987654321'];
      const batches = client._batchBySize(phones);
      assert.strictEqual(batches.length, 1);
      assert.deepStrictEqual(batches[0], phones);
    });

    it('should batch large payloads into chunks of 5000', () => {
      const client = new BlacklistAlliance('test-key');
      const phones = Array(12000).fill('1234567890');
      const batches = client._batchBySize(phones);
      assert.strictEqual(batches.length, 3);
      assert.strictEqual(batches[0].length, 5000);
      assert.strictEqual(batches[1].length, 5000);
      assert.strictEqual(batches[2].length, 2000);
    });
  });

  describe('lookupSingle', () => {
    it('should build correct URL with params', async () => {
      const client = new BlacklistAlliance('test-key');
      let calledUrl;

      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'success', message: 'Clean' }),
        };
      };

      await client.lookupSingle('1234567890');

      assert.ok(calledUrl.includes('key=test-key'));
      assert.ok(calledUrl.includes('phone=1234567890'));
      assert.ok(calledUrl.includes('ver=v5'));
      assert.ok(calledUrl.includes('resp=json'));

      global.fetch = originalFetch;
    });

    it('should validate phone by default', async () => {
      const client = new BlacklistAlliance('test-key');
      await assert.rejects(
        () => client.lookupSingle('123'),
        /Invalid phone number/
      );
    });

    it('should skip validation when disabled', async () => {
      const client = new BlacklistAlliance('test-key');
      let calledUrl;

      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'success' }),
        };
      };

      await client.lookupSingle('123', { validate: false });
      assert.ok(calledUrl.includes('phone=123'));

      global.fetch = originalFetch;
    });
  });

  describe('bulkLookupSimple', () => {
    it('should reject empty array', async () => {
      const client = new BlacklistAlliance('test-key');
      await assert.rejects(
        () => client.bulkLookupSimple([]),
        /phones must be a non-empty array/
      );
    });

    it('should reject non-array', async () => {
      const client = new BlacklistAlliance('test-key');
      await assert.rejects(
        () => client.bulkLookupSimple('not-an-array'),
        /phones must be a non-empty array/
      );
    });
  });

  describe('emailBulk', () => {
    it('should hash emails when option is set', async () => {
      const client = new BlacklistAlliance('test-key');
      let sentBody;

      const originalFetch = global.fetch;
      global.fetch = async (url, options) => {
        sentBody = JSON.parse(options.body);
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ good: [] }),
        };
      };

      await client.emailBulk(['test@example.com'], { hashEmails: true });

      // Should be MD5 hash, not raw email
      assert.ok(!sentBody.emails.includes('test@example.com'));
      assert.strictEqual(sentBody.emails[0], '55502f40dc8b7c769880b10874abc9d0');

      global.fetch = originalFetch;
    });

    it('should send raw emails by default', async () => {
      const client = new BlacklistAlliance('test-key');
      let sentBody;

      const originalFetch = global.fetch;
      global.fetch = async (url, options) => {
        sentBody = JSON.parse(options.body);
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ good: ['test@example.com'] }),
        };
      };

      await client.emailBulk(['test@example.com']);

      assert.deepStrictEqual(sentBody.emails, ['test@example.com']);

      global.fetch = originalFetch;
    });
  });

  describe('result merging', () => {
    it('should merge bulk results correctly', () => {
      const client = new BlacklistAlliance('test-key');
      const results = [
        [{ status: 'success', numbers: 2, count: 2, phones: ['111', '222'], supression: ['111'], wireless: [], reasons: { '111': 'dnc' }, carrier: {} }],
        [{ status: 'success', numbers: 2, count: 2, phones: ['333', '444'], supression: ['333'], wireless: ['444'], reasons: { '333': 'litigator' }, carrier: {} }],
      ];

      const merged = client._mergeBulkResults(results);

      assert.strictEqual(merged.numbers, 4);
      assert.strictEqual(merged.count, 4);
      assert.deepStrictEqual(merged.phones, ['111', '222', '333', '444']);
      assert.deepStrictEqual(merged.supression, ['111', '333']);
      assert.deepStrictEqual(merged.wireless, ['444']);
      assert.deepStrictEqual(merged.reasons, { '111': 'dnc', '333': 'litigator' });
    });

    it('should merge email results correctly', () => {
      const client = new BlacklistAlliance('test-key');
      const results = [
        { good: ['a@test.com'], bad: ['b@test.com'] },
        { good: ['c@test.com'], bad: ['d@test.com'] },
      ];

      const merged = client._mergeEmailResults(results);

      assert.deepStrictEqual(merged.good, ['a@test.com', 'c@test.com']);
      assert.deepStrictEqual(merged.bad, ['b@test.com', 'd@test.com']);
    });
  });

  describe('BlacklistAllianceError', () => {
    it('should have correct properties', () => {
      const error = new BlacklistAllianceError('Test error', 403, { message: 'Invalid key' });
      assert.strictEqual(error.message, 'Test error');
      assert.strictEqual(error.statusCode, 403);
      assert.deepStrictEqual(error.response, { message: 'Invalid key' });
      assert.strictEqual(error.name, 'BlacklistAllianceError');
    });

    it('should create AuthenticationError for 401/403', () => {
      const error = BlacklistAllianceError.fromResponse('Auth failed', 403, null);
      assert.strictEqual(error.name, 'AuthenticationError');
      assert.ok(error instanceof AuthenticationError);
      assert.ok(error instanceof BlacklistAllianceError);
    });

    it('should create RateLimitError for 429 with retryAfter', () => {
      const error = BlacklistAllianceError.fromResponse('Rate limited', 429, null, { retryAfter: 60 });
      assert.strictEqual(error.name, 'RateLimitError');
      assert.strictEqual(error.retryAfter, 60);
      assert.ok(error instanceof RateLimitError);
    });

    it('should create ValidationError for 400/422', () => {
      const error = BlacklistAllianceError.fromResponse('Invalid input', 400, null);
      assert.strictEqual(error.name, 'ValidationError');
      assert.ok(error instanceof ValidationError);
    });

    it('should create ServerError for 5xx', () => {
      const error = BlacklistAllianceError.fromResponse('Server error', 500, null);
      assert.strictEqual(error.name, 'ServerError');
      assert.ok(error instanceof ServerError);
    });

    it('should create TimeoutError', () => {
      const error = new TimeoutError('Request timeout', null);
      assert.strictEqual(error.name, 'TimeoutError');
      assert.strictEqual(error.statusCode, 408);
    });

    it('should create NetworkError with original error', () => {
      const originalError = new Error('ECONNRESET');
      const error = new NetworkError('Connection reset', originalError);
      assert.strictEqual(error.name, 'NetworkError');
      assert.strictEqual(error.originalError, originalError);
    });

    it('should create CircuitBreakerError', () => {
      const error = new CircuitBreakerError('Circuit open');
      assert.strictEqual(error.name, 'CircuitBreakerError');
      assert.strictEqual(error.statusCode, 503);
    });
  });

  describe('retry logic', () => {
    it('should retry on 5xx errors', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 2 });
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          return {
            ok: false,
            status: 500,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Server error' }),
          };
        }
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'success', message: 'Clean' }),
        };
      };

      const result = await client.lookupSingle('1234567890');
      assert.strictEqual(attemptCount, 3);
      assert.strictEqual(result.status, 'success');

      global.fetch = originalFetch;
    });

    it('should retry on 429 rate limits', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 1 });
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          return {
            ok: false,
            status: 429,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Rate limited' }),
          };
        }
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'success', message: 'Clean' }),
        };
      };

      const result = await client.lookupSingle('1234567890');
      assert.strictEqual(attemptCount, 2);
      assert.strictEqual(result.status, 'success');

      global.fetch = originalFetch;
    });

    it('should NOT retry on 4xx client errors (except 408, 429)', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 3 });
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Forbidden' }),
        };
      };

      await assert.rejects(
        () => client.lookupSingle('1234567890'),
        /Forbidden/
      );
      assert.strictEqual(attemptCount, 1); // No retries

      global.fetch = originalFetch;
    });

    it('should respect max retries and fail after exhausting', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 2 });
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Bad gateway' }),
        };
      };

      await assert.rejects(
        () => client.lookupSingle('1234567890'),
        /Bad Gateway/
      );
      assert.strictEqual(attemptCount, 3); // 1 initial + 2 retries

      global.fetch = originalFetch;
    });

    it('should retry on network errors', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 1 });
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          const error = new Error('Network error');
          error.code = 'ECONNRESET';
          throw error;
        }
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'success', message: 'Clean' }),
        };
      };

      const result = await client.lookupSingle('1234567890');
      assert.strictEqual(attemptCount, 2);
      assert.strictEqual(result.status, 'success');

      global.fetch = originalFetch;
    });

    it('should NOT retry when retries is 0', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 0 });
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Server error' }),
        };
      };

      await assert.rejects(
        () => client.lookupSingle('1234567890'),
        /Internal Server Error/
      );
      assert.strictEqual(attemptCount, 1);

      global.fetch = originalFetch;
    });
  });

  describe('request/response hooks', () => {
    it('should call onRequest hook before request', async () => {
      let hookCalled = false;
      let hookedUrl = null;
      let hookedInfo = null;

      const client = new BlacklistAlliance('test-key', {
        onRequest: (url, info) => {
          hookCalled = true;
          hookedUrl = url;
          hookedInfo = info;
        }
      });

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success' }),
      });

      await client.lookupSingle('1234567890');

      assert.strictEqual(hookCalled, true);
      assert.ok(hookedUrl.includes('1234567890'));
      assert.strictEqual(hookedInfo.method, 'GET');

      global.fetch = originalFetch;
    });

    it('should call onResponse hook after response', async () => {
      let hookCalled = false;
      let hookedResponse = null;
      let hookedData = null;

      const client = new BlacklistAlliance('test-key', {
        onResponse: (response, data) => {
          hookCalled = true;
          hookedResponse = response;
          hookedData = data;
        }
      });

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success', message: 'Clean' }),
      });

      await client.lookupSingle('1234567890');

      assert.strictEqual(hookCalled, true);
      assert.strictEqual(hookedResponse.status, 200);
      assert.deepStrictEqual(hookedData, { status: 'success', message: 'Clean' });

      global.fetch = originalFetch;
    });

    it('should support async hooks', async () => {
      let asyncComplete = false;

      const client = new BlacklistAlliance('test-key', {
        onRequest: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          asyncComplete = true;
        }
      });

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'success' }),
      });

      await client.lookupSingle('1234567890');
      assert.strictEqual(asyncComplete, true);

      global.fetch = originalFetch;
    });
  });

  describe('AbortController support', () => {
    it('should abort request when signal is already aborted', async () => {
      const client = new BlacklistAlliance('test-key');
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        () => client.lookupSingle('1234567890', { signal: controller.signal }),
        /Request aborted/
      );
    });

    it('should abort request when signal fires', async () => {
      const client = new BlacklistAlliance('test-key', { timeout: 60000 });
      const controller = new AbortController();

      const originalFetch = global.fetch;
      global.fetch = async (url, options) => {
        // Wait for abort or timeout
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ status: 'success' }),
            });
          }, 200);

          // Listen for abort from the passed signal
          options.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      };

      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      await assert.rejects(
        () => client.lookupSingle('1234567890', { signal: controller.signal }),
        (err) => err instanceof TimeoutError && err.message === 'Request aborted'
      );

      global.fetch = originalFetch;
    });

    it('should NOT retry when user aborts', async () => {
      const client = new BlacklistAlliance('test-key', { retries: 3 });
      const controller = new AbortController();
      let attemptCount = 0;

      const originalFetch = global.fetch;
      global.fetch = async () => {
        attemptCount++;
        // Abort on first attempt
        controller.abort();
        // Simulate network abort
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      };

      await assert.rejects(
        () => client.lookupSingle('1234567890', { signal: controller.signal }),
        /Request aborted/
      );
      assert.strictEqual(attemptCount, 1); // No retries after user abort

      global.fetch = originalFetch;
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const client = new BlacklistAlliance('test-key', {
        retries: 0,
        circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000 }
      });

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Server error' }),
      });

      // First 3 requests should fail normally
      for (let i = 0; i < 3; i++) {
        await assert.rejects(() => client.lookupSingle('1234567890'));
      }

      // 4th request should fail with CircuitBreakerError
      await assert.rejects(
        () => client.lookupSingle('1234567890'),
        (err) => err instanceof CircuitBreakerError
      );

      global.fetch = originalFetch;
    });

    it('should transition to HALF_OPEN after cooldown', async () => {
      const client = new BlacklistAlliance('test-key', {
        retries: 0,
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 100 }
      });

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: 'Error',
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });

      // Open the circuit
      await assert.rejects(() => client.lookupSingle('1234567890'));
      await assert.rejects(() => client.lookupSingle('1234567890'));

      // Should be OPEN now
      await assert.rejects(
        () => client.lookupSingle('1234567890'),
        (err) => err instanceof CircuitBreakerError
      );

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should allow request (HALF_OPEN)
      await assert.rejects(() => client.lookupSingle('1234567890'));

      global.fetch = originalFetch;
    });

    it('should close circuit on HALF_OPEN success', async () => {
      const client = new BlacklistAlliance('test-key', {
        retries: 0,
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 100 }
      });

      let requestCount = 0;
      const originalFetch = global.fetch;
      global.fetch = async () => {
        requestCount++;
        if (requestCount <= 2) {
          return {
            ok: false,
            status: 500,
            statusText: 'Error',
            headers: { get: () => 'application/json' },
            json: async () => ({}),
          };
        }
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'success' }),
        };
      };

      // Open circuit
      await assert.rejects(() => client.lookupSingle('1234567890'));
      await assert.rejects(() => client.lookupSingle('1234567890'));

      // Wait for HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));

      // This should succeed and close the circuit
      const result = await client.lookupSingle('1234567890');
      assert.strictEqual(result.status, 'success');

      // Next request should work (circuit is CLOSED)
      await client.lookupSingle('1234567890');

      global.fetch = originalFetch;
    });

    it('should call onStateChange hook', async () => {
      const states = [];
      const client = new BlacklistAlliance('test-key', {
        retries: 0,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 50,
          onStateChange: (state) => states.push(state)
        }
      });

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: 'Error',
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });

      // Trigger state changes
      await assert.rejects(() => client.lookupSingle('1234567890'));
      await assert.rejects(() => client.lookupSingle('1234567890'));

      assert.ok(states.includes('OPEN'));

      global.fetch = originalFetch;
    });
  });
});
