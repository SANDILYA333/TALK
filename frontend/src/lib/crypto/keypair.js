import {
  IDENTITY_ALGORITHM,
  IDENTITY_VERSION,
  PUBLIC_KEY_BYTE_LENGTH,
  PRIVATE_KEY_USAGES,
  PUBLIC_KEY_USAGES,
} from "./constants.js";
import { KeyGenerationError, KeySerializationError } from "./errors.js";
import { bytesToBase64, bytesToHex, getSubtleCrypto, hexToBytes, base64ToBytes } from "./utils.js";

/**
 * Generates a fresh, secure asymmetric X25519 identity keypair using Web Crypto API.
 * 
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey }>}
 */
export async function generateIdentityKeyPair() {
  const subtle = getSubtleCrypto();

  try {
    const keyPair = await subtle.generateKey(
      {
        name: IDENTITY_ALGORITHM,
      },
      true, // extractable (for local encrypted persistence)
      PRIVATE_KEY_USAGES,
    );

    return {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    };
  } catch (error) {
    throw new KeyGenerationError("Failed to generate X25519 identity keypair", error);
  }
}

/**
 * Exports a public CryptoKey to canonical raw 32 bytes and standard string encodings.
 * 
 * @param {CryptoKey} publicKey
 * @returns {Promise<{ version: number, algorithm: string, raw: Uint8Array, hex: string, base64: string }>}
 */
export async function exportPublicKey(publicKey) {
  if (!publicKey || publicKey.type !== "public") {
    throw new KeySerializationError("Invalid public key provided for export");
  }

  const subtle = getSubtleCrypto();

  try {
    const rawBuffer = await subtle.exportKey("raw", publicKey);
    const rawBytes = new Uint8Array(rawBuffer);

    if (rawBytes.byteLength !== PUBLIC_KEY_BYTE_LENGTH) {
      throw new KeySerializationError(
        `Exported public key has unexpected length: ${rawBytes.byteLength} (expected ${PUBLIC_KEY_BYTE_LENGTH})`
      );
    }

    return {
      version: IDENTITY_VERSION,
      algorithm: IDENTITY_ALGORITHM,
      raw: rawBytes,
      hex: bytesToHex(rawBytes),
      base64: bytesToBase64(rawBytes),
    };
  } catch (error) {
    if (error instanceof KeySerializationError) throw error;
    throw new KeySerializationError("Failed to export public key", error);
  }
}

/**
 * Imports a raw, hex, or base64 formatted public key into a CryptoKey object.
 * 
 * @param {Uint8Array|ArrayBuffer|string} keyData - Raw bytes, hex string (64 chars), or base64 string
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(keyData) {
  let rawBytes;

  if (typeof keyData === "string") {
    const trimmed = keyData.trim();
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      rawBytes = hexToBytes(trimmed);
    } else {
      rawBytes = base64ToBytes(trimmed);
    }
  } else if (keyData instanceof Uint8Array) {
    rawBytes = keyData;
  } else if (keyData instanceof ArrayBuffer) {
    rawBytes = new Uint8Array(keyData);
  } else {
    throw new KeySerializationError("Unsupported public key format for import");
  }

  if (rawBytes.byteLength !== PUBLIC_KEY_BYTE_LENGTH) {
    throw new KeySerializationError(
      `Invalid public key length: ${rawBytes.byteLength} bytes (expected ${PUBLIC_KEY_BYTE_LENGTH})`
    );
  }

  const subtle = getSubtleCrypto();

  try {
    return await subtle.importKey(
      "raw",
      rawBytes,
      {
        name: IDENTITY_ALGORITHM,
      },
      true,
      PUBLIC_KEY_USAGES,
    );
  } catch (error) {
    throw new KeySerializationError("Failed to import public key into Web Crypto API", error);
  }
}

/**
 * Exports a private CryptoKey to PKCS#8 format for secure local storage.
 * 
 * @param {CryptoKey} privateKey
 * @returns {Promise<Uint8Array>}
 */
export async function exportPrivateKey(privateKey) {
  if (!privateKey || privateKey.type !== "private") {
    throw new KeySerializationError("Invalid private key provided for export");
  }

  const subtle = getSubtleCrypto();

  try {
    const pkcs8Buffer = await subtle.exportKey("pkcs8", privateKey);
    return new Uint8Array(pkcs8Buffer);
  } catch (error) {
    throw new KeySerializationError("Failed to export private key", error);
  }
}

/**
 * Imports a PKCS#8 formatted private key into a CryptoKey object.
 * 
 * @param {Uint8Array|ArrayBuffer} pkcs8Buffer
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(pkcs8Buffer) {
  const bytes = pkcs8Buffer instanceof Uint8Array ? pkcs8Buffer : new Uint8Array(pkcs8Buffer);

  if (!bytes || bytes.byteLength === 0) {
    throw new KeySerializationError("Empty PKCS#8 buffer provided for private key import");
  }

  const subtle = getSubtleCrypto();

  try {
    return await subtle.importKey(
      "pkcs8",
      bytes,
      {
        name: IDENTITY_ALGORITHM,
      },
      true,
      PRIVATE_KEY_USAGES,
    );
  } catch (error) {
    throw new KeySerializationError("Failed to import private key from PKCS#8 format", error);
  }
}
