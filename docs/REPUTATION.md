# Reputation weighting and anti-spam

`reputation.submit` accepts a 1–5 rating once a job is `Completed` and the rater
is a participant. Every raw rating is stored unchanged; the **aggregate** is
derived from those raw ratings by `get_aggregate`.

## The rule

For an address, `get_aggregate` walks the ratings it has received and, for each:

1. **Anti-spam:** only the *first* rating from a given rater counts. Later
   ratings from the same rater (in other escrows) are stored but do not count.
2. **Weighting:** the counted rating is weighted by its escrow's
   `total_amount` (read from the escrow contract).

It returns:

```rust
Aggregate {
    total_score: u64, // sum(score * weight)
    weight: u64,      // sum(weight)
    count: u64,       // number of counted ratings
}
```

The average is `total_score / weight` (0 when `weight` is 0). `count` is the
number of ratings that counted, so the UI can still show "N review(s)".

This is integer-only (no floating point on-chain). Rounding is left to the
display layer.

## Why this rule

- **Amount weighting** makes a high rating on a meaningful job worth more than a
  high rating on a trivial one, without changing the raw data.
- **One rating per (rater, ratee) pair** blunts the cheapest farm: a user can no
  longer inflate a counterparty (or themselves) by splitting work into many
  tiny escrows.
- **Derived, not stored** means the rule can be changed later without a data
  migration — the raw ratings are the source of truth.

## Residual sybil risk (not solved)

- A colluding pair can still rate each other once, and can choose the size of
  that one escrow to maximise its weight.
- The rule assumes escrow `total_amount` is real value; on testnet it is not.
- There is no decay by recency and no per-pair amount cap. These are deliberate
  omissions to keep the rule small and explainable, and are candidates for a
  follow-up.

This is a mitigation, not a guarantee.
