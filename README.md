# Romeo — Matchmaking Algorithm Engine

A deterministic, explainable matchmaking engine built for a 20-person cohort. No LLM in the scoring loop — every number is traceable.

---

## Architecture Overview

```
CSV Data → parsers.js → Structured Profiles → algorithm.js → Scores + Matching
                                                  │
                                    ┌──────────────┼──────────────┐
                                    ▼              ▼              ▼
                              Directional    Gale-Shapley    Monte Carlo
                               Scoring       Matching       Confidence
```

---

## Why Directional Scoring

Compatibility is **not symmetric**. A→B ≠ B→A because:

- **Dealbreakers are personal.** A may have `smoking` as a dealbreaker while B doesn't. If B smokes, A→B takes a 50-point penalty but B→A is unaffected.
- **Love language matching is directional.** A wants to *receive* Physical Touch; B *gives* via Acts of Service. That mismatch hurts A→B but may not affect B→A (B might be fine receiving whatever A gives).
- **Growth bonus is directional.** If A is "trying to be more ambitious" and B's core value *is* ambitious, B embodies what A aspires to — but not necessarily vice versa.

Formula (per pair direction):

```
total = Σ (categoryScore × weight)

DEFAULT_WEIGHTS:
  lifeGoals:    0.25    values:      0.20
  lifestyle:    0.15    loveLanguage: 0.15
  interests:    0.10    dealbreaker:  0.15
```

---

## Why Harmonic Mean

Reciprocal score uses the **harmonic mean** of both directional scores:

```
H(a, b) = 2ab / (a + b)
```

| A→B | B→A | Arithmetic | Harmonic |
|-----|-----|------------|----------|
| 90  | 50  | 70.0       | 64.3     |
| 80  | 80  | 80.0       | 80.0     |
| 95  | 30  | 62.5       | 45.6     |

The harmonic mean **penalizes imbalance**. A 90/50 pairing scores 64.3, not 70. This forces mutual compatibility — a great match must be good for *both* people.

---

## Why Gale-Shapley

The [Gale-Shapley algorithm](https://en.wikipedia.org/wiki/Gale%E2%80%93Shapley_algorithm) (1962, Nobel Prize 2012) produces a **stable matching**: no two unmatched people would both prefer each other over their assigned partners.

Properties of our implementation:
- **Male-proposing** variant → male-optimal, female-pessimal stable matching
- A "Mutually Optimal" badge means the top-ranked candidate survived **game-theoretic analysis** of the full cohort
- Runs in O(n²) proposals worst-case (here: 10×10 = 100 max)

The stable matching is a stronger claim than "highest score" — it says the pairing survives strategic analysis where everyone acts in self-interest.

---

## How Confidence Works

Monte Carlo sensitivity analysis answers: **"How robust is this #1 pick?"**

```
For trial in 1..100:
  1. Perturb each weight by ×(1 + uniform(-0.2, 0.2))
  2. Renormalize weights to sum to 1.0
  3. Recompute all reciprocal scores under perturbed weights
  4. Record who comes out #1

confidence = count(most_frequent_winner) / 100
```

- **Confidence ≥ 0.80**: Match is robust. The #1 pick survives ±20% weight uncertainty.
- **Confidence 0.50–0.79**: Match is plausible but sensitive to assumptions.
- **Confidence < 0.50**: Ranking is unstable — multiple candidates are close.

This reports **actual robustness**, not opinion. A judge can re-run with different trial counts and verify convergence.

---

## Feature Attribution

Raw scores lack context. "72 out of 100 in Life Goals" — is that good?

Attribution solves this by comparing each category score to the **cohort average** — the target's average score across *all* opposite-gender candidates:

```
delta = candidateScore − cohortAverage
```

| Category        | Score | Cohort Avg | Delta  |
|-----------------|-------|------------|--------|
| Life Goals      | 85    | 71         | +14    |
| Values          | 70    | 68         | +2     |
| Lifestyle       | 60    | 78         | −18    |

"+14 vs cohort avg" is meaningful. "85 out of 100" is not, without context.

Positive deltas highlight why this candidate stands out. Negative deltas surface potential friction points.

---

## Category Scoring Details

### Life Goals (25%)
Blends three sub-scores with weights 50/35/15:
- **Relationship goal** compatibility matrix (marriage/serious/open)
- **Children preference** matrix (wants/open/does_not_want)
- **Family importance** (high/moderate): same=100, different=50

### Values (20%)
- **Identical** core values: 100
- **Complementary** pairs (e.g., ambitious+independent): 75
- **Other** combinations: 50
- **Growth bonus** (directional): +20 if partner embodies your growth target

### Lifestyle (15%)
Average of 5 binary sub-scores:
- Smoking, drinking, diet, planning style, social style

### Love Language (15%)
Directional: Does B *give* what A wants to *receive*?
- Exact match: 100 | Related pair: 60 | Mismatch: 30

### Interests (10%)
Jaccard similarity of activity tags, scaled:
- `score = jaccard × 70 + 30` (zero overlap = 30, full = 100)

### Dealbreaker (15%)
Penalty-based. Starts at 100, subtracts per violation:
- Smoking trigger: −50 | Mismatched life goals trigger: −40
