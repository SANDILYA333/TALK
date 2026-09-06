# Architecture Guide: Asynchronous UI State & Race Condition Prevention

## 1. The Async Race Condition Problem
In rich single-page applications (SPAs), users interact with search inputs dynamically. When multiple asynchronous requests are initiated in close succession, network latency variations can cause responses to return **out of order**:

```text
Time ──►
t1: User types "TALK-AAAA-AAAA" ──► Request A sent (Slow server response: 300ms)
t2: User types "TALK-BBBB-BBBB" ──► Request B sent (Fast server response: 50ms)
t3: Response B arrives (50ms)   ──► UI displays "Result B" (Correct!)
t4: Response A arrives (300ms)  ──► UI displays "Result A" (BUG: Stale data overwrites UI!)
```

This bug confuses the user because the displayed identity does not match the text currently in the search input.

## 2. Solutions Comparison

### Approach 1: AbortController (`signal`)
- Cancels the in-flight HTTP request.
- *Downside*: Network stack aborts may throw cancellation errors that require specialized catch logic.

### Approach 2: Monotonic Sequence Tracking (`searchSeqRef`) — TALK Implementation
- A mutable reference holds an incrementing integer counter:
```javascript
const searchSeqRef = useRef(0);

const search = async (input) => {
  const currentSeq = ++searchSeqRef.current;
  
  const data = await fetchApi(input);
  
  // Guard: If another search started while this was in-flight, discard!
  if (currentSeq !== searchSeqRef.current) {
    return;
  }
  
  setResult(data);
};
```

### Why Sequence Tracking is Superior for Discovery UI:
1. **Zero Abort Overhead**: Clean asynchronous flow without unhandled promise rejection warnings.
2. **Deterministic State Resolution**: Only the latest user-initiated intent is ever committed to React state.
3. **Instant Reset Compatibility**: Calling `reset()` increments `searchSeqRef.current`, instantly invalidating all in-flight network requests.
