# Security Guide: Connect ID Enumeration Attacks, Entropy Analysis, and Rate Limiting

## 1. What is an Identity Enumeration Attack?
An **enumeration attack** occurs when an adversary systematically queries an API with sequential or dictionary-generated identifiers to discover valid accounts, map network topologies, or harvest profile information.

```text
Attacker Script:
GET /api/identity/lookup/TALK-0000-0000 ──► 404 (Not Found)
GET /api/identity/lookup/TALK-0000-0001 ──► 404 (Not Found)
...
GET /api/identity/lookup/TALK-8F2K-91XZ ──► 200 OK (Found: Alice Cooper!)
```

## 2. Mathematical Entropy of TALK Connect IDs
TALK Connect IDs are derived by taking the first 5 bytes (40 bits) of the domain-separated SHA-256 hash of an X25519 public key and encoding them into 8 Crockford Base32 characters:

$$\text{Search Space Size} = 2^{40} = 1,099,511,627,776 \approx 1.1 \times 10^{12} \text{ possibilities}$$

### Collision and Brute-Force Probabilities:
- If a system has $100,000$ active registered users ($N = 10^5$), the probability of any random guess hitting an active account is:
  $$P(\text{Hit}) = \frac{10^5}{1.1 \times 10^{12}} \approx 9.09 \times 10^{-8}$$
- An attacker would need to execute over **$11,000,000$ HTTP requests** on average to stumble upon a single valid registered account by blind guessing.

## 3. Defense-in-Depth Mitigations

### 1. Mandatory Session Authentication
The lookup endpoint requires a valid Clerk authentication session (`protectRoute`). Unauthenticated requests are dropped at the edge with `401 Unauthorized`, preventing anonymous botnet crawling.

### 2. Sliding-Window Rate Limiting
The server enforces an in-memory rate limiter of **30 requests per minute per authenticated user**:
- If a user sends $>30$ queries in 60 seconds, subsequent requests are throttled with `429 Too Many Requests` and a `Retry-After` header.
- At 30 requests/minute (1,800/hour), scanning 11,000,000 queries would take a single account **over 254 days of continuous scanning**, making automated harvesting economically and computationally infeasible.

### 3. Response Minimization
Even when a valid Connect ID is found, the API returns **zero PII** (no email, no phone, no Clerk account ID, no database `_id`), denying attackers any personal identity correlation data.
