/**
 * JSON-safe serialization utilities for Prompt messages and ConversationMetadata.
 *
 * Handles special types (Date, URL, Uint8Array) that require custom encoding
 * for safe storage and round-trip restoration.
 */

import type { Prompt } from '@effect/ai';
import type { ConversationMetadata } from '../context';

// -----------------------------------------------------------------------------
// Type Markers for Special Values
// -----------------------------------------------------------------------------

const TYPE_MARKER = '__$type';
const DATE_TYPE = 'Date';
const URL_TYPE = 'URL';
const UINT8ARRAY_TYPE = 'Uint8Array';

interface TypedValue {
  [TYPE_MARKER]: string;
  value: unknown;
}

function isTypedValue(val: unknown): val is TypedValue {
  return (
    typeof val === 'object' &&
    val !== null &&
    TYPE_MARKER in val &&
    'value' in val
  );
}

// -----------------------------------------------------------------------------
// JSON Replacer/Reviver for Special Types
// -----------------------------------------------------------------------------

/**
 * JSON replacer that encodes Date, URL, and Uint8Array for safe serialization.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { [TYPE_MARKER]: DATE_TYPE, value: value.toISOString() };
  }
  if (value instanceof URL) {
    return { [TYPE_MARKER]: URL_TYPE, value: value.href };
  }
  if (value instanceof Uint8Array) {
    // Encode binary as base64
    const base64 = Buffer.from(value).toString('base64');
    return { [TYPE_MARKER]: UINT8ARRAY_TYPE, value: base64 };
  }
  return value;
}

/**
 * JSON reviver that restores Date, URL, and Uint8Array from encoded form.
 */
function jsonReviver(_key: string, value: unknown): unknown {
  if (isTypedValue(value)) {
    switch (value[TYPE_MARKER]) {
      case DATE_TYPE:
        return new Date(value.value as string);
      case URL_TYPE:
        return new URL(value.value as string);
      case UINT8ARRAY_TYPE:
        return new Uint8Array(Buffer.from(value.value as string, 'base64'));
    }
  }
  return value;
}

// -----------------------------------------------------------------------------
// Deep Transform Utilities
// -----------------------------------------------------------------------------

/**
 * Recursively transforms values using a transformer function.
 * Handles arrays and plain objects.
 */
function deepTransform(
  value: unknown,
  transformer: (key: string, val: unknown) => unknown,
  key = ''
): unknown {
  const transformed = transformer(key, value);

  if (Array.isArray(transformed)) {
    return transformed.map((item, idx) =>
      deepTransform(item, transformer, String(idx))
    );
  }

  if (
    typeof transformed === 'object' &&
    transformed !== null &&
    !(transformed instanceof Date) &&
    !(transformed instanceof URL) &&
    !(transformed instanceof Uint8Array)
  ) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(transformed)) {
      result[k] = deepTransform(v, transformer, k);
    }
    return result;
  }

  return transformed;
}

// -----------------------------------------------------------------------------
// Message Serialization
// -----------------------------------------------------------------------------

/**
 * Serialized message format for SQL storage.
 */
export interface SerializedMessage {
  /**
   * The JSON-encoded message payload with special types preserved.
   */
  payload: string;
}

/**
 * Serialize a Prompt message for SQL storage.
 * Encodes special types (Date, URL, Uint8Array) as typed markers.
 */
export function serializeMessage(message: Prompt.MessageEncoded): SerializedMessage {
  const encoded = deepTransform(message, jsonReplacer);
  return {
    payload: JSON.stringify(encoded),
  };
}

/**
 * Deserialize a Prompt message from SQL storage.
 * Accepts either a JSON string (SQLite TEXT) or parsed object (Postgres JSONB).
 */
export function deserializeMessage(input: string | object): Prompt.MessageEncoded {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  return deepTransform(parsed, jsonReviver) as Prompt.MessageEncoded;
}

// -----------------------------------------------------------------------------
// Metadata Serialization
// -----------------------------------------------------------------------------

/**
 * Serialized metadata format for SQL storage.
 * Splits createdAt/updatedAt into top-level columns for querying.
 */
export interface SerializedMetadata {
  /**
   * ISO 8601 string for created timestamp (stored in SQL column).
   */
  createdAt: string;

  /**
   * ISO 8601 string for updated timestamp (stored in SQL column).
   */
  updatedAt: string;

  /**
   * JSON-encoded remaining metadata with special types preserved.
   */
  metadata: string;
}

/**
 * Serialize ConversationMetadata for SQL storage.
 * Extracts createdAt/updatedAt for column storage, encodes rest as JSON.
 */
export function serializeMetadata(
  metadata: ConversationMetadata
): SerializedMetadata {
  const { createdAt, updatedAt, ...rest } = metadata;
  const encoded = deepTransform(rest, jsonReplacer);

  return {
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    metadata: JSON.stringify(encoded),
  };
}

/**
 * Deserialize ConversationMetadata from SQL storage.
 * Accepts JSON string or parsed object for metadata field.
 */
export function deserializeMetadata(
  createdAt: string | Date,
  updatedAt: string | Date,
  metadata: string | object
): ConversationMetadata {
  const parsedMetadata =
    typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  const restoredMetadata = deepTransform(parsedMetadata, jsonReviver) as Record<
    string,
    unknown
  >;

  return {
    createdAt: createdAt instanceof Date ? createdAt : new Date(createdAt),
    updatedAt: updatedAt instanceof Date ? updatedAt : new Date(updatedAt),
    ...restoredMetadata,
  };
}
