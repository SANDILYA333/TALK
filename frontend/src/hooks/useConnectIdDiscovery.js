import { useState, useRef, useCallback } from "react";
import { lookupIdentityByConnectId } from "../lib/api/identity.js";
import { normalizeConnectId, isValidConnectId } from "../lib/crypto/connect-id.js";

/**
 * Custom React hook for Connect ID discovery with asynchronous race condition protection.
 *
 * Guarantees:
 * 1. Strict sequence ID tracking so slow responses from prior queries never overwrite current search state.
 * 2. Instant client-side format validation before making network requests.
 * 3. Clear, segregated UX states: 'idle', 'loading', 'success', 'not_found', 'error'.
 * 4. PII-free public identity state storage.
 *
 * @param {object} [options]
 * @param {string} [options.token] Optional Clerk session token
 * @returns {object} Discovery state and actions
 */
export function useConnectIdDiscovery(options = {}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle"); // 'idle' | 'loading' | 'success' | 'not_found' | 'error'
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Sequence reference to discard out-of-order asynchronous responses
  const searchSeqRef = useRef(0);

  const reset = useCallback(() => {
    searchSeqRef.current += 1;
    setStatus("idle");
    setResult(null);
    setErrorMessage(null);
    setQuery("");
  }, []);

  const search = useCallback(
    async (rawInput) => {
      const currentSeq = ++searchSeqRef.current;
      const trimmed = (rawInput ?? query).trim();

      if (!trimmed) {
        setStatus("idle");
        setResult(null);
        setErrorMessage(null);
        return;
      }

      // Step 1: Client-Side Normalization & Pre-validation
      let normalized;
      try {
        normalized = normalizeConnectId(trimmed);
        if (!isValidConnectId(normalized)) {
          throw new Error("Invalid Connect ID format (expected TALK-XXXX-XXXX)");
        }
      } catch (err) {
        if (currentSeq !== searchSeqRef.current) return;
        setStatus("error");
        setResult(null);
        setErrorMessage(err.message || "Invalid Connect ID format");
        return;
      }

      // Step 2: Transition to Loading state
      setStatus("loading");
      setErrorMessage(null);

      // Step 3: Perform Network Lookup
      try {
        const data = await lookupIdentityByConnectId(normalized, { token: options.token });

        // Race Condition Guard: If another search started while this was in-flight, discard!
        if (currentSeq !== searchSeqRef.current) return;

        setResult(data);
        setStatus("success");
        setErrorMessage(null);
      } catch (err) {
        // Race Condition Guard
        if (currentSeq !== searchSeqRef.current) return;

        setResult(null);
        if (err.code === "NOT_FOUND" || err.status === 404) {
          setStatus("not_found");
          setErrorMessage("No user was found with this Connect ID.");
        } else if (err.code === "RATE_LIMITED" || err.status === 429) {
          setStatus("error");
          setErrorMessage(
            `Search rate limit exceeded. Please wait ${err.retryAfter || 60} seconds before trying again.`
          );
        } else {
          setStatus("error");
          setErrorMessage(err.message || "An unexpected error occurred while searching.");
        }
      }
    },
    [query, options.token]
  );

  return {
    query,
    setQuery,
    status,
    result,
    errorMessage,
    search,
    reset,
    isLoading: status === "loading",
    isSuccess: status === "success",
    isNotFound: status === "not_found",
    isError: status === "error",
  };
}
