import { KeySerializationError } from "./errors.js";

/**
 * Converts a Uint8Array or ArrayBuffer to a lowercase hexadecimal string.
 * @param {Uint8Array|ArrayBuffer} buffer
 * @returns {string}
 */
export function bytesToHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Converts a hexadecimal string to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new KeySerializationError("Invalid hexadecimal string format");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Converts a Uint8Array or ArrayBuffer to a standard Base64 string.
 * @param {Uint8Array|ArrayBuffer} buffer
 * @returns {string}
 */
export function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

/**
 * Converts a Base64 string to a Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  if (typeof base64 !== "string" || base64.trim() === "") {
    throw new KeySerializationError("Invalid base64 string format");
  }
  try {
    if (typeof globalThis.Buffer !== "undefined") {
      const buf = globalThis.Buffer.from(base64, "base64");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    throw new KeySerializationError("Failed to decode base64 string", error);
  }
}

/**
 * Validates that the runtime environment provides cryptographically secure Web Crypto APIs.
 * @returns {SubtleCrypto}
 */
export function getSubtleCrypto() {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new KeySerializationError("Web Cryptography API (crypto.subtle) is not supported in this environment");
  }
  return cryptoObj.subtle;
}
