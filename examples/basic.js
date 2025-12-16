/**
 * Basic usage examples for blacklist-alliance-client
 *
 * Run with: BLACKLIST_API_KEY=your-key node examples/basic.js
 */

const { BlacklistAlliance, BlacklistAllianceError } = require('../src');

const API_KEY = process.env.BLACKLIST_API_KEY;

if (!API_KEY) {
  console.error('Please set BLACKLIST_API_KEY environment variable');
  process.exit(1);
}

async function main() {
  // Basic client (with default retry and no logging)
  const client = new BlacklistAlliance(API_KEY);

  // Example 1: Single phone lookup
  console.log('--- Single Phone Lookup ---');
  try {
    const result = await client.lookupSingle('2223334444');
    console.log('Status:', result.status);
    console.log('Message:', result.message);
    if (result.message === 'Blacklisted') {
      console.log('Reason codes:', result.code);
    }
    if (result.carrier) {
      console.log('Carrier:', result.carrier.name);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }

  // Example 2: Bulk phone lookup
  console.log('\n--- Bulk Phone Lookup ---');
  try {
    // 2223334444 = clean, 9999999999 = blacklisted
    const result = await client.bulkLookupSimple(['2223334444', '9999999999']);
    console.log('Total checked:', result.numbers);
    console.log('Clean phones:', result.phones);
    console.log('Blacklisted:', result.supression);
    console.log('Reasons:', result.reasons);
  } catch (error) {
    console.error('Error:', error.message);
  }

  // Example 3: Email blacklist check
  console.log('\n--- Email Blacklist Check ---');
  try {
    const result = await client.emailBulk(['test@example.com', 'test@test.com']);
    console.log('Clean emails:', result.good);
    console.log('Blacklisted:', result.bad);
  } catch (error) {
    console.error('Error:', error.message);
  }

  // Example 4: Simple boolean check
  console.log('\n--- Boolean Check ---');
  try {
    const isBlacklisted = await client.isBlacklisted('9999999999');
    console.log('Is blacklisted:', isBlacklisted);
  } catch (error) {
    console.error('Error:', error.message);
  }

  // Example 5: Error handling
  console.log('\n--- Error Handling ---');
  try {
    await client.lookupSingle('123'); // Invalid phone
  } catch (error) {
    if (error instanceof BlacklistAllianceError) {
      console.log('Caught BlacklistAllianceError');
      console.log('  Message:', error.message);
      console.log('  Status code:', error.statusCode);
    }
  }
}

main();
