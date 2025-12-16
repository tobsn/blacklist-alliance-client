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
  good?: string[];
  bad?: string[];
}

export interface Logger {
  debug?(message: string, meta?: object): void;
  info?(message: string, meta?: object): void;
  warn?(message: string, meta?: object): void;
  error?(message: string, meta?: object): void;
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
}

export interface LookupOptionsJson {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** @default 'json' */
  responseFormat?: 'json';
  /** Validate phone format before sending. @default true */
  validate?: boolean;
}

export interface LookupOptionsRaw {
  version?: ApiVersion;
  responseFormat: 'raw';
  validate?: boolean;
}

export type LookupOptions = LookupOptionsJson | LookupOptionsRaw;

export interface StandardLookupOptionsJson {
  version?: ApiVersion;
  responseFormat?: 'json';
  validate?: boolean;
}

export interface StandardLookupOptionsRaw {
  version?: ApiVersion;
  responseFormat: 'raw' | 'xml';
  validate?: boolean;
}

export type StandardLookupOptions = StandardLookupOptionsJson | StandardLookupOptionsRaw;

export interface BulkOptionsJson {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** @default 'json' */
  responseFormat?: 'json';
  /** Auto-split large payloads into batches. @default true */
  autoBatch?: boolean;
}

export interface BulkOptionsPhonecode {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** Returns phone:code pairs as text (auto-batching disabled for this format) */
  responseFormat: 'phonecode';
  /** Auto-batching is disabled for phonecode format. @default false */
  autoBatch?: boolean;
}

export type BulkOptions = BulkOptionsJson | BulkOptionsPhonecode;

export interface StandardBulkOptions {
  /** @default 'v5' (uses client default) */
  version?: ApiVersion;
  /** Auto-split large payloads into batches. @default true */
  autoBatch?: boolean;
}

export interface EmailBulkOptions {
  /** Convert emails to MD5 hashes before sending (for privacy). @default false */
  hashEmails?: boolean;
  /** Auto-split large payloads into batches. @default true */
  autoBatch?: boolean;
}

export interface EmailCheckOptions {
  /** Convert email to MD5 hash before sending (for privacy). @default false */
  hashEmail?: boolean;
}

export class BlacklistAllianceError extends Error {
  name: 'BlacklistAllianceError';
  statusCode: number;
  response: unknown;

  constructor(message: string, statusCode: number, response: unknown);
}

export class BlacklistAlliance {
  apiKey: string;
  defaultVersion: ApiVersion;
  timeout: number;
  retries: number;
  logger: Logger | null;

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
}
