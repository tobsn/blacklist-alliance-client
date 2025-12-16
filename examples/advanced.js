/**
 * Advanced usage examples for blacklist-alliance-client
 *
 * Demonstrates: logging, retry configuration, batch processing, MD5 hashing
 *
 * Run with: BLACKLIST_API_KEY=your-key node examples/advanced.js
 */

const { BlacklistAlliance, BlacklistAllianceError } = require('../src');

const API_KEY = process.env.BLACKLIST_API_KEY;

if (!API_KEY) {
  console.error('Please set BLACKLIST_API_KEY environment variable');
  process.exit(1);
}

// Simple custom logger that adds timestamps
const customLogger = {
  debug: (msg, meta) => console.log(`[DEBUG ${new Date().toISOString()}] ${msg}`, meta || ''),
  info: (msg, meta) => console.log(`[INFO  ${new Date().toISOString()}] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN  ${new Date().toISOString()}] ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[ERROR ${new Date().toISOString()}] ${msg}`, meta || ''),
};

async function main() {
  // Client with custom configuration
  const client = new BlacklistAlliance(API_KEY, {
    defaultVersion: 'v5',
    timeout: 15000,      // 15 second timeout
    retries: 5,          // More retries for reliability
    logger: customLogger // Enable logging
  });

  // ===============================================
  // Example 1: Bulk lookup with progress tracking
  // ===============================================
  console.log('\n=== Bulk Lookup with Logging ===\n');

  // Generate sample phone numbers
  const phones = Array.from({ length: 100 }, (_, i) =>
    `555${String(i).padStart(7, '0')}`
  );

  console.log(`Processing ${phones.length} phone numbers...`);
  console.log('(Watch the logs to see request activity)\n');

  try {
    const result = await client.bulkLookupSimple(phones);
    console.log('\nResults:');
    console.log(`  Total processed: ${result.count}`);
    console.log(`  Blacklisted: ${result.supression.length}`);
    console.log(`  Wireless: ${result.wireless.length}`);
  } catch (error) {
    console.error('Bulk lookup failed:', error.message);
  }

  // ===============================================
  // Example 2: Email check with MD5 hashing
  // ===============================================
  console.log('\n=== Email Check with MD5 Hashing ===\n');

  const emails = [
    'user1@example.com',
    'user2@example.com',
    'spam@badactor.com'
  ];

  // Show what the hashes look like
  console.log('Emails will be hashed before sending:');
  for (const email of emails) {
    console.log(`  ${email} -> ${client.hashEmail(email)}`);
  }

  try {
    // hashEmails: true converts to MD5 before sending
    const result = await client.emailBulk(emails, { hashEmails: true });
    console.log('\nResults:');
    console.log(`  Clean (good): ${result.good?.length || 0}`);
    console.log(`  Blacklisted (bad): ${result.bad?.length || 0}`);
  } catch (error) {
    console.error('Email check failed:', error.message);
  }

  // ===============================================
  // Example 3: Custom retry handling
  // ===============================================
  console.log('\n=== Custom Error Handling ===\n');

  // Client with no retries (for testing error handling)
  const noRetryClient = new BlacklistAlliance(API_KEY, {
    retries: 0,
    logger: customLogger
  });

  try {
    // This will fail immediately on any error (no retries)
    await noRetryClient.lookupSingle('5551234567');
    console.log('Lookup succeeded');
  } catch (error) {
    if (error instanceof BlacklistAllianceError) {
      console.log('API Error Details:');
      console.log(`  Message: ${error.message}`);
      console.log(`  Status Code: ${error.statusCode}`);
      console.log(`  Response: ${JSON.stringify(error.response)}`);

      // Handle specific error codes
      switch (error.statusCode) {
        case 403:
          console.log('  -> Invalid API key');
          break;
        case 422:
          console.log('  -> Invalid phone number format');
          break;
        case 429:
          console.log('  -> Rate limited, try again later');
          break;
        case 500:
        case 502:
        case 503:
          console.log('  -> Server error, would normally retry');
          break;
      }
    } else {
      console.error('Unexpected error:', error);
    }
  }

  // ===============================================
  // Example 4: Filtering results
  // ===============================================
  console.log('\n=== Filtering Bulk Results ===\n');

  try {
    const testPhones = ['2223334444', '3334445555', '4445556666'];
    const result = await client.bulkLookupSimple(testPhones);

    // Get only clean numbers (not in suppression list)
    const cleanNumbers = result.phones.filter(
      phone => !result.supression.includes(phone)
    );
    console.log('Clean numbers:', cleanNumbers);

    // Get blacklisted numbers with their reasons
    const blacklistedWithReasons = result.supression.map(phone => ({
      phone,
      reasons: result.reasons[phone]?.split(',') || ['unknown']
    }));
    console.log('Blacklisted:', blacklistedWithReasons);

    // Get wireless numbers
    const wirelessNumbers = result.wireless;
    console.log('Wireless:', wirelessNumbers);

  } catch (error) {
    console.error('Failed:', error.message);
  }
}

main().catch(console.error);
