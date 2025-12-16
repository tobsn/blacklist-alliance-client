export type ApiVersion = 'v1' | 'v2' | 'v3' | 'v5';
export type ResponseFormat = 'json' | 'raw';
export type StandardResponseFormat = 'json' | 'raw' | 'xml';
export type BulkResponseFormat = 'json' | 'phonecode';

export interface CarrierInfo {
  did: string;
  type: string;
  name: string;
  state: string;
  ratecenter: string;
  country: string;
  clli: string;
  lata: string | number;
  wireless: string;
  lrn: string | number;
  npa: string | number;
  nxx: string | number;
  nxxx: string | number;
  ocn: string | number;
  port_type: string;
}

export interface SingleLookupResult {
  sid: string;
  status: string;
  message: string;
  code: string;
  offset: number;
  wireless: number;
  phone: string;
  results: number;
  time: number;
  scrubs: string;
  carrier?: CarrierInfo;
}

export interface BulkLookupResult {
  status: string;
  numbers: number;
  count: number;
  phones: string[];
  /** Blacklisted phone numbers. Note: API uses the spelling "supression" (not "suppression"). */
  supression: string[];
  wireless: string[];
  reasons: Record<string, string>;
  carrier: Record<string, CarrierInfo>;
}

export interface EmailBulkResult {
  /** Emails that are NOT blacklisted (returned by API) */
  good: string[];
  /** Emails that ARE blacklisted (computed: submitted minus good) */
  bad: string[];
}

export interface Logger {
  debug?(message: string, meta?: object): void;
  info?(message: string, meta?: object): void;
  warn?(message: string, meta?: object): void;
  error?(message: string, meta?: object): void;
}

/** Request info passed to onRequest hook */
export interface RequestInfo {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Response info passed to onResponse hook */
export interface ResponseInfo {
  status: number;
  headers: Headers;
}

/** Progress info passed to onProgress callback */
export interface ProgressInfo {
  /** Number of items completed so far */
  completed: number;
  /** Total number of items */
  total: number;
  /** Current batch number (1-indexed) */
  batch: number;
  /** Total number of batches */
  totalBatches: number;
}

/** Circuit breaker configuration */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit. @default 5 */
  failureThreshold?: number;
  /** Milliseconds to wait before attempting HALF_OPEN. @default 30000 */
  resetTimeoutMs?: number;
  /** Callback when circuit state changes */
  onStateChange?: (state: 'CLOSED' | 'OPEN' | 'HALF_OPEN') => void;
}

export interface ClientOptions {
  /** @default 'v5' */
  defaultVersion?: ApiVersion;
  /** Request timeout in milliseconds (per attempt, not total). @default 30000 */
  timeout?: number;
  /** Number of retry attempts for transient errors. @default 3 */
  retries?: number;
  /** Logger instance (console, pino, winston compatible). @default null */
  logger?: Logger;
  /** Enable dry run mode - returns mock data without making API calls. @default false */
  dryRun?: boolean;
  /** Hook called before each request */
  onRequest?: (url: string, info: RequestInfo) => void | Promise<void>;
  /** Hook called after each successful response */
  onResponse?: (response: ResponseInfo, data: unknown) => void | Promise<void>;
  /** Circuit breaker configuration. @default null */
  circuitBreaker?: CircuitBreakerOptions;
}

export interface LookupOptionsJson {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** @default 'json' */
  responseFormat?: 'json';
  /** Validate phone format before sending. @default true */
  validate?: boolean;
  /** AbortSignal for cancelling the request */
  signal?: AbortSignal;
}

export interface LookupOptionsRaw {
  version?: ApiVersion;
  responseFormat: 'raw';
  validate?: boolean;
  /** AbortSignal for cancelling the request */
  signal?: AbortSignal;
}

export type LookupOptions = LookupOptionsJson | LookupOptionsRaw;

export interface StandardLookupOptionsJson {
  version?: ApiVersion;
  responseFormat?: 'json';
  validate?: boolean;
  signal?: AbortSignal;
}

export interface StandardLookupOptionsRaw {
  version?: ApiVersion;
  responseFormat: 'raw' | 'xml';
  validate?: boolean;
  signal?: AbortSignal;
}

export type StandardLookupOptions = StandardLookupOptionsJson | StandardLookupOptionsRaw;

export interface BulkOptionsJson {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** @default 'json' */
  responseFormat?: 'json';
  /** Auto-split large payloads into batches. @default true */
  autoBatch?: boolean;
  signal?: AbortSignal;
  /** Progress callback for batch operations */
  onProgress?: (info: ProgressInfo) => void;
}

export interface BulkOptionsPhonecode {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** Returns phone:code pairs as text (auto-batching disabled for this format) */
  responseFormat: 'phonecode';
  /** Auto-batching is disabled for phonecode format. @default false */
  autoBatch?: boolean;
  signal?: AbortSignal;
  /** Progress callback for batch operations */
  onProgress?: (info: ProgressInfo) => void;
}

export type BulkOptions = BulkOptionsJson | BulkOptionsPhonecode;

export interface StandardBulkOptions {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** Auto-split large payloads into batches. @default true */
  autoBatch?: boolean;
  signal?: AbortSignal;
  /** Progress callback for batch operations */
  onProgress?: (info: ProgressInfo) => void;
}

export interface EmailBulkOptions {
  /** Convert emails to MD5 hashes before sending (for privacy). @default false */
  hashEmails?: boolean;
  /** Auto-split large payloads into batches. @default true */
  autoBatch?: boolean;
  /** Validate email format before sending. @default true */
  validate?: boolean;
  signal?: AbortSignal;
  /** Progress callback for batch operations */
  onProgress?: (info: ProgressInfo) => void;
}

export interface EmailCheckOptions {
  /** Convert email to MD5 hash before sending (for privacy). @default false */
  hashEmail?: boolean;
}

/** Base error class for all Blacklist Alliance errors */
export class BlacklistAllianceError extends Error {
  name: 'BlacklistAllianceError';
  statusCode: number;
  response: unknown;

  constructor(message: string, statusCode: number, response: unknown);

  /** Factory method to create appropriate error subclass based on status code */
  static fromResponse(
    message: string,
    statusCode: number,
    response: unknown,
    options?: { retryAfter?: number }
  ): BlacklistAllianceError;
}

/** Authentication/authorization error (401, 403) */
export class AuthenticationError extends BlacklistAllianceError {
  name: 'AuthenticationError';
}

/** Rate limit exceeded (429) */
export class RateLimitError extends BlacklistAllianceError {
  name: 'RateLimitError';
  /** Seconds to wait before retrying (if provided by API) */
  retryAfter: number | null;

  constructor(message: string, response: unknown, retryAfter?: number);
}

/** Validation error for invalid input (400, 422) */
export class ValidationError extends BlacklistAllianceError {
  name: 'ValidationError';
}

/** Request timeout (408 or AbortError) */
export class TimeoutError extends BlacklistAllianceError {
  name: 'TimeoutError';

  constructor(message: string, response: unknown);
}

/** Network connectivity error */
export class NetworkError extends BlacklistAllianceError {
  name: 'NetworkError';
  originalError: Error | null;

  constructor(message: string, originalError?: Error);
}

/** Server error (5xx) */
export class ServerError extends BlacklistAllianceError {
  name: 'ServerError';
}

/** Circuit breaker is open - requests blocked */
export class CircuitBreakerError extends BlacklistAllianceError {
  name: 'CircuitBreakerError';

  constructor(message: string);
}

export class BlacklistAlliance {
  apiKey: string;
  defaultVersion: ApiVersion;
  timeout: number;
  retries: number;
  logger: Logger | null;
  dryRun: boolean;

  constructor(apiKey: string, options?: ClientOptions);

  /**
   * Lookup a single phone number (Simple API)
   * Returns raw string when responseFormat is 'raw'
   */
  lookupSingle(phone: string, options: LookupOptionsRaw): Promise<string>;
  lookupSingle(phone: string, options?: LookupOptionsJson): Promise<SingleLookupResult>;
  lookupSingle(phone: string, options?: LookupOptions): Promise<SingleLookupResult | string>;

  /**
   * Lookup multiple phone numbers in bulk (Simple API)
   * Returns raw string when responseFormat is 'phonecode'
   */
  bulkLookupSimple(phones: string[], options: BulkOptionsPhonecode): Promise<string>;
  bulkLookupSimple(phones: string[], options?: BulkOptionsJson): Promise<BulkLookupResult>;
  bulkLookupSimple(phones: string[], options?: BulkOptions): Promise<BulkLookupResult | string>;

  /**
   * Check emails against blacklist (Simple API)
   */
  emailBulk(emails: string[], options?: EmailBulkOptions): Promise<EmailBulkResult>;

  /**
   * Lookup a single phone number (Standard RESTful API)
   * Returns raw string when responseFormat is 'raw' or 'xml'
   */
  lookup(phone: string, options: StandardLookupOptionsRaw): Promise<string>;
  lookup(phone: string, options?: StandardLookupOptionsJson): Promise<SingleLookupResult>;
  lookup(phone: string, options?: StandardLookupOptions): Promise<SingleLookupResult | string>;

  /**
   * Lookup multiple phone numbers in bulk (Standard RESTful API)
   */
  bulkLookup(phones: string[], options?: StandardBulkOptions): Promise<BulkLookupResult>;

  /**
   * Check if a single phone number is blacklisted
   */
  isBlacklisted(phone: string): Promise<boolean>;

  /**
   * Check if an email is blacklisted
   */
  isEmailBlacklisted(email: string, options?: EmailCheckOptions): Promise<boolean>;

  /**
   * Get blacklist reasons for a phone number
   */
  getBlacklistReasons(phone: string): Promise<string[]>;

  /**
   * Hash an email to MD5
   */
  hashEmail(email: string): string;

  /**
   * Check API connectivity (health check)
   * Returns true if API is reachable and responding
   */
  ping(): Promise<boolean>;
}
