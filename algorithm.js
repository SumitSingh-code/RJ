/**
 * algorithm.js — Core matchmaking engine for Romeo.
 *
 * Implements a 5-layer scoring pipeline:
 *   Layer 1: Directional scoring (A→B ≠ B→A)
 *   Layer 2: Reciprocal scoring via harmonic mean
 *   Layer 3: Gale-Shapley stable matching
 *   Layer 4: Monte Carlo confidence analysis
 *   Layer 5: Feature attribution with cohort comparison
 *
 * Exports:
 *   - DEFAULT_WEIGHTS
 *   - scoreDirectional(A, B, weights?)
 *   - scoreReciprocal(A, B, weights?)
 *   - galeShapley(profiles)
 *   - monteCarloConfidence(targetId, profiles, numTrials?)
 *   - getAttribution(targetId, candidateId, allProfiles)
 *   - computeAll(profiles)
 */

import { parseAllProfiles } from './parsers.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default category weights for the scoring formula.
 * These sum to 1.0 and define how much each dimension matters.
 *
 * The dealbreaker weight (0.15) acts as a penalty layer — it starts at 100
 * and subtracts for violations, so a high weight means violations hurt more.
 */
export const DEFAULT_WEIGHTS = {
  lifeGoals: 0.25,      // Relationship goal + children + family importance
  values: 0.20,         // Core value synergy + growth bonus
  lifestyle: 0.15,      // Smoking, drinking, diet, planning, social style
  loveLanguage: 0.15,   // What A wants vs what B gives
  interests: 0.10,      // Shared activity tags (Jaccard)
  dealbreaker: 0.15     // Penalty for exhibiting partner's dealbreakers
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILITY MATRICES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Relationship goal compatibility matrix.
 *
 * Reasoning:
 *   marriage-marriage (100): Perfect alignment on intent and timeline.
 *   marriage-serious (70):   Both want long-term, but one is firmer on timing.
 *   marriage-open (20):      Major mismatch — one is ready, other is exploring.
 *   serious-serious (90):    Strong alignment, slight uncertainty on both sides.
 *   serious-open (50):       One wants commitment, other is still deciding.
 *   open-open (70):          Both flexible, but flexibility ≠ deep alignment.
 */
const RELATIONSHIP_GOAL_MATRIX = {
  'marriage-marriage': 100,
  'marriage-serious': 70,
  'marriage-open': 20,
  'serious-marriage': 70,
  'serious-serious': 90,
  'serious-open': 50,
  'open-marriage': 20,
  'open-serious': 50,
  'open-open': 70
};

/**
 * Children preference compatibility matrix.
 *
 * Reasoning:
 *   wants-wants (100):              Both committed to having children.
 *   wants-open (70):                One is flexible, can still work.
 *   wants-does_not_want (0):        Fundamental incompatibility.
 *   open-open (80):                 Both flexible, slight alignment bonus.
 *   open-does_not_want (50):        One could go either way, possible tension.
 *   does_not_want-does_not_want (100): Both aligned on no children.
 */
const CHILDREN_PREF_MATRIX = {
  'wants-wants': 100,
  'wants-open': 70,
  'wants-does_not_want': 0,
  'open-wants': 70,
  'open-open': 80,
  'open-does_not_want': 50,
  'does_not_want-wants': 0,
  'does_not_want-open': 50,
  'does_not_want-does_not_want': 100
};

/**
 * Core value synergy — set of complementary pairs that score 75.
 *
 * Each pair is documented with reasoning for why they complement each other.
 * Identical values score 100, these complementary pairs score 75,
 * and all other combinations score 50 (neutral — not inherently bad, just no synergy).
 */
const COMPLEMENTARY_VALUE_PAIRS = new Set([
  // ambitious + independent: both value self-reliance and personal drive
  'ambitious-independent', 'independent-ambitious',
  // family_oriented + loyal: both relationship/commitment-focused
  'family_oriented-loyal', 'loyal-family_oriented',
  // compassionate + spiritual: both empathy/inward-growth oriented
  'compassionate-spiritual', 'spiritual-compassionate',
  // creative + adventurous: both novelty-seeking, open to new experiences
  'creative-adventurous', 'adventurous-creative',
  // intellectual + ambitious: both growth-oriented, value achievement
  'intellectual-ambitious', 'ambitious-intellectual',
  // compassionate + family_oriented: both people-centered, caring
  'compassionate-family_oriented', 'family_oriented-compassionate',
  // loyal + compassionate: both prioritize others' wellbeing
  'loyal-compassionate', 'compassionate-loyal',
  // intellectual + creative: both value mental stimulation and originality
  'intellectual-creative', 'creative-intellectual',
  // independent + adventurous: both value freedom and exploration
  'independent-adventurous', 'adventurous-independent',
  // spiritual + family_oriented: both value deeper meaning and connection
  'spiritual-family_oriented', 'family_oriented-spiritual'
]);

/**
 * Love language "related pairs" — not exact matches, but adjacent
 * enough that partial credit (60) is warranted.
 *
 * Reasoning:
 *   physical_touch + quality_time: Both require physical presence and closeness.
 *   words_of_affirmation + gifts: Both are explicit expressions of appreciation.
 *   acts_of_service + quality_time: Both involve dedicating time/effort to partner.
 */
const RELATED_LOVE_LANGUAGE_PAIRS = new Set([
  'physical_touch-quality_time', 'quality_time-physical_touch',
  'words_of_affirmation-gifts', 'gifts-words_of_affirmation',
  'acts_of_service-quality_time', 'quality_time-acts_of_service'
]);

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — DIRECTIONAL SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute directional compatibility score for the ordered pair (A, B).
 *
 * This answers: "How good is B for A?" — which is NOT the same as
 * "How good is A for B?" because dealbreakers, love language matching,
 * and growth bonuses are inherently personal/directional.
 *
 * Returns a detailed breakdown with total score (0-100), per-category
 * scores, and any dealbreaker flags that fired.
 *
 * @param {object} A - ParsedProfile of the person asking "how good is B for me?"
 * @param {object} B - ParsedProfile of the candidate being evaluated
 * @param {object} [weights=DEFAULT_WEIGHTS] - Category weight overrides
 * @returns {object} Scoring breakdown with total, categories, and flags
 */
export function scoreDirectional(A, B, weights = DEFAULT_WEIGHTS) {
  const flags = [];

  // ── Life Goals (25%): Blend of relationship goal, children, family ──
  // Relationship goal compatibility: how aligned are their relationship intents?
  const goalKey = `${A.relationshipGoal}-${B.relationshipGoal}`;
  const goalScore = RELATIONSHIP_GOAL_MATRIX[goalKey] ?? 50;

  // Children preference: can they agree on whether to have kids?
  const childKey = `${A.childrenPreference}-${B.childrenPreference}`;
  const childScore = CHILDREN_PREF_MATRIX[childKey] ?? 50;

  // Family importance: how closely do they prioritize family?
  const familyScore = (A.familyImportance === B.familyImportance) ? 100 : 50;

  // Weighted blend: relationship goal matters most (50%), then children (35%),
  // then family importance (15%) — reflecting decreasing immediacy of impact
  const lifeGoalsScore = goalScore * 0.50 + childScore * 0.35 + familyScore * 0.15;

  // ── Values (20%): Core value synergy + directional growth bonus ──
  let synergyScore;
  if (A.coreValue === B.coreValue) {
    // Identical values = maximum synergy
    synergyScore = 100;
  } else if (COMPLEMENTARY_VALUE_PAIRS.has(`${A.coreValue}-${B.coreValue}`)) {
    // Complementary pairing = strong but not identical synergy
    synergyScore = 75;
  } else {
    // Unrelated values = neutral (not bad, just no recognized synergy)
    synergyScore = 50;
  }

  // DIRECTIONAL growth bonus: if A is actively trying to grow toward a trait
  // that B already embodies as their core value, B can inspire A's growth.
  // This is checked from A's perspective only — B may not benefit the same way.
  const growthBonus = (A.selfImprovementTarget === B.coreValue) ? 20 : 0;

  // Cap at 100 to prevent over-inflation
  const valuesScore = Math.min(100, synergyScore + growthBonus);

  // ── Lifestyle (15%): Average of 5 practical compatibility sub-scores ──

  // Smoking: both non-smokers is ideal (100), one smokes creates friction (30),
  // both smoke is tolerable but not ideal (80)
  let smokingScore;
  if (!A.isSmoker && !B.isSmoker) smokingScore = 100;
  else if (A.isSmoker && B.isSmoker) smokingScore = 80;
  else smokingScore = 30;

  // Drinking: same habit = 100, social vs none = 70 (manageable difference)
  let drinkingScore;
  if (A.drinkingHabit === B.drinkingHabit) drinkingScore = 100;
  else drinkingScore = 70;

  // Diet: same = 100, different = 60 (can coexist but daily meal friction)
  let dietScore;
  if (A.diet === B.diet) dietScore = 100;
  else dietScore = 60;

  // Planning style: same = 100, different = 50 (routine vs spontaneous
  // is a common source of relationship friction)
  let planningScore;
  if (A.planningStyle === B.planningStyle) planningScore = 100;
  else planningScore = 50;

  // Social style: same = 100, different = 60 (intro/extro can work,
  // but requires compromise on social activities)
  let socialScore;
  if (A.socialStyle === B.socialStyle) socialScore = 100;
  else socialScore = 60;

  // Simple average of all 5 sub-scores
  const lifestyleScore = (smokingScore + drinkingScore + dietScore + planningScore + socialScore) / 5;

  // ── Love Language (15%): DIRECTIONAL match ──
  // Does B's showsCareVia (what B gives) match A's loveLanguage (what A wants)?
  // This is the most inherently directional category — A might love receiving
  // gifts but B might show care via acts of service.
  let loveLanguageScore;
  if (A.loveLanguage === B.showsCareVia) {
    // Perfect match: B gives exactly what A wants to receive
    loveLanguageScore = 100;
  } else if (RELATED_LOVE_LANGUAGE_PAIRS.has(`${A.loveLanguage}-${B.showsCareVia}`)) {
    // Related pair: not exact, but adjacent languages
    loveLanguageScore = 60;
  } else {
    // Mismatch: B's care style doesn't align with A's needs
    loveLanguageScore = 30;
  }

  // ── Interests (10%): Jaccard overlap of activity tags ──
  // Jaccard index = |intersection| / |union|, scaled to 30-100 range
  // so even zero overlap still gets 30 (shared activities are nice-to-have,
  // not essential for compatibility)
  const setA = new Set(A.activityTags);
  const setB = new Set(B.activityTags);
  const intersection = [...setA].filter(tag => setB.has(tag)).length;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const interestsScore = jaccard * 70 + 30;

  // ── Dealbreaker (15%): Penalty-based scoring ──
  // Start at 100, subtract for each of A's dealbreakers that B actually exhibits.
  // This is directional: A's dealbreakers are checked against B's traits.
  let dealbreakerScore = 100;

  for (const db of A.dealbreakers) {
    switch (db) {
      case 'smoking':
        // Does B actually smoke? Only fires if B.isSmoker === true
        if (B.isSmoker === true) {
          dealbreakerScore -= 50;
          flags.push('Smoking habit');
        }
        break;

      case 'heavy_drinking':
        // No one in this dataset is a heavy drinker (all are social or none),
        // so this never fires. Kept for completeness and extensibility.
        break;

      case 'avoidant_conflict':
        // No one in this dataset has an avoidant conflict style
        // (all are easygoing or direct), so this never fires.
        break;

      case 'lack_of_ambition':
        // All participants have established careers/goals, so no one
        // triggers the "no drive or direction" flag in this dataset.
        break;

      case 'mismatched_life_goals':
        // Fires when relationship goals are very different:
        //   - A wants marriage but B is open (or vice versa): major gap
        //   - A wants children but B does not (or vice versa): fundamental conflict
        if (
          (A.relationshipGoal === 'marriage' && B.relationshipGoal === 'open') ||
          (A.childrenPreference === 'wants' && B.childrenPreference === 'does_not_want') ||
          (A.childrenPreference === 'does_not_want' && B.childrenPreference === 'wants')
        ) {
          dealbreakerScore -= 40;
          flags.push('Mismatched life goals');
        }
        break;
    }
  }

  // Ensure score doesn't go below 0
  dealbreakerScore = Math.max(0, dealbreakerScore);

  // ── Weighted sum across all categories ──
  const categories = {
    lifeGoals: {
      score: lifeGoalsScore,
      weighted: lifeGoalsScore * weights.lifeGoals
    },
    values: {
      score: valuesScore,
      weighted: valuesScore * weights.values
    },
    lifestyle: {
      score: lifestyleScore,
      weighted: lifestyleScore * weights.lifestyle
    },
    loveLanguage: {
      score: loveLanguageScore,
      weighted: loveLanguageScore * weights.loveLanguage
    },
    interests: {
      score: interestsScore,
      weighted: interestsScore * weights.interests
    },
    dealbreaker: {
      score: dealbreakerScore,
      weighted: dealbreakerScore * weights.dealbreaker
    }
  };

  const total = Object.values(categories).reduce((sum, cat) => sum + cat.weighted, 0);

  return { total, categories, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — RECIPROCAL SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute reciprocal compatibility using harmonic mean of directional scores.
 *
 * Why harmonic mean? It penalizes imbalanced pairings more heavily than
 * arithmetic mean. A pairing that's 90/50 scores 64.3 (harmonic) vs 70
 * (arithmetic). This forces mutual compatibility — a great match must be
 * good in BOTH directions.
 *
 * Formula: H = 2 * ab * ba / (ab + ba)
 * If both scores are 0, returns 0 to avoid division by zero.
 *
 * @param {object} A - ParsedProfile
 * @param {object} B - ParsedProfile
 * @param {object} [weights=DEFAULT_WEIGHTS] - Category weight overrides
 * @returns {object} { score, scoreAB, scoreBA }
 */
export function scoreReciprocal(A, B, weights = DEFAULT_WEIGHTS) {
  const scoreAB = scoreDirectional(A, B, weights);
  const scoreBA = scoreDirectional(B, A, weights);

  const ab = scoreAB.total;
  const ba = scoreBA.total;

  // Harmonic mean: heavily penalizes asymmetric pairings
  const harmonicMean = (ab + ba === 0) ? 0 : (2 * ab * ba) / (ab + ba);

  return {
    score: harmonicMean,
    scoreAB,
    scoreBA
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — GALE-SHAPLEY STABLE MATCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classical Gale-Shapley deferred-acceptance algorithm for stable matching.
 *
 * This is the standard algorithm from Gale & Shapley (1962). It produces
 * the MALE-OPTIMAL, FEMALE-PESSIMAL stable matching. This means:
 *   - Every male gets the best partner he could possibly get in ANY stable matching.
 *   - Every female gets the worst partner she could get in any stable matching.
 *   - The result is STABLE: no two unmatched people would both prefer each other
 *     over their current partners.
 *
 * A "Mutually Optimal" badge in the UI means the top-ranked candidate survived
 * this game-theoretic analysis of the full cohort — it's not just about raw scores.
 *
 * Algorithm steps:
 *   1. Separate profiles into males and females.
 *   2. Each male builds a preference list: all females ranked by directional
 *      score (male→female) in descending order.
 *   3. Each female builds a ranking map: for each male, his rank = position
 *      in her preference list (sorted by directional score female→male descending).
 *   4. Males propose round by round:
 *      - Each free (unmatched) male proposes to his most-preferred female
 *        he hasn't proposed to yet.
 *      - Each female who receives proposals compares them (and her current
 *        partner, if any) using her ranking. She keeps the one she prefers
 *        and rejects all others.
 *      - Rejected males become free and try again next round.
 *   5. Repeat until every male is matched.
 *   6. Return a bidirectional Map: every person's id maps to their partner's id.
 *
 * @param {object[]} profiles - Array of ParsedProfile objects
 * @returns {Map<string, string>} Bidirectional matching: id → partner's id
 */
export function galeShapley(profiles) {
  // Step 1: Separate into males and females
  const males = profiles.filter(p => p.gender === 'M');
  const females = profiles.filter(p => p.gender === 'F');

  // Step 2: Build each male's preference list (females ranked by male→female score, desc)
  const malePrefs = new Map();
  for (const m of males) {
    const prefs = females
      .map(f => ({
        id: f.id,
        score: scoreDirectional(m, f).total
      }))
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.id);
    malePrefs.set(m.id, prefs);
  }

  // Step 3: Build each female's ranking map (lower rank number = more preferred)
  // femaleRanking.get('P03') = Map { 'P01' => 0, 'P05' => 1, ... }
  const femaleRanking = new Map();
  for (const f of females) {
    const ranked = males
      .map(m => ({
        id: m.id,
        score: scoreDirectional(f, m).total
      }))
      .sort((a, b) => b.score - a.score);

    const rankMap = new Map();
    ranked.forEach((entry, idx) => rankMap.set(entry.id, idx));
    femaleRanking.set(f.id, rankMap);
  }

  // Step 4: Proposal rounds

  // Track each male's next proposal index (which female to propose to next)
  const nextProposal = new Map();
  males.forEach(m => nextProposal.set(m.id, 0));

  // Track which female each male is currently matched with (null = free)
  const malePartner = new Map();
  males.forEach(m => malePartner.set(m.id, null));

  // Track which male each female is currently matched with (null = free)
  const femalePartner = new Map();
  females.forEach(f => femalePartner.set(f.id, null));

  // List of currently free males
  let freeMales = males.map(m => m.id);

  // Keep proposing until all males are matched
  while (freeMales.length > 0) {
    const nextFreeMales = [];

    for (const maleId of freeMales) {
      const prefList = malePrefs.get(maleId);
      const nextIdx = nextProposal.get(maleId);

      // Safety check: if male has proposed to everyone (shouldn't happen
      // with equal numbers), he stays free
      if (nextIdx >= prefList.length) {
        nextFreeMales.push(maleId);
        continue;
      }

      // Propose to the next female on his preference list
      const femaleId = prefList[nextIdx];
      nextProposal.set(maleId, nextIdx + 1);

      const currentPartner = femalePartner.get(femaleId);

      if (currentPartner === null) {
        // Female is free — she accepts the proposal
        femalePartner.set(femaleId, maleId);
        malePartner.set(maleId, femaleId);
      } else {
        // Female is already matched — compare proposer vs current partner
        const rankings = femaleRanking.get(femaleId);
        const currentRank = rankings.get(currentPartner);
        const proposerRank = rankings.get(maleId);

        if (proposerRank < currentRank) {
          // Female prefers the proposer (lower rank = higher preference)
          // Free the current partner
          malePartner.set(currentPartner, null);
          nextFreeMales.push(currentPartner);

          // Accept the proposer
          femalePartner.set(femaleId, maleId);
          malePartner.set(maleId, femaleId);
        } else {
          // Female prefers her current partner — reject the proposer
          nextFreeMales.push(maleId);
        }
      }
    }

    freeMales = nextFreeMales;
  }

  // Step 5: Build bidirectional result map
  const matching = new Map();
  for (const [maleId, femaleId] of malePartner) {
    if (femaleId !== null) {
      matching.set(maleId, femaleId);
      matching.set(femaleId, maleId);
    }
  }

  return matching;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — MONTE CARLO CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monte Carlo sensitivity analysis for match robustness.
 *
 * How it works:
 *   1. For the target profile, find all opposite-gender candidates.
 *   2. Run numTrials rounds. In each round:
 *      a. Perturb the default weights: multiply each weight by
 *         (1 + uniform_random(-0.2, 0.2)), then renormalize so they sum to 1.0.
 *         This models ±20% uncertainty in how much each category "really" matters.
 *      b. Compute reciprocal scores for target vs all candidates under
 *         the perturbed weights.
 *      c. Record which candidate scored highest.
 *   3. Count how often each candidate appeared as #1.
 *   4. The confidence score is the fraction of trials where the most-frequent
 *      top pick was #1. High confidence (>0.8) means the match is robust
 *      to reasonable weight changes. Low confidence (<0.5) means the ranking
 *      is sensitive to assumptions about what matters.
 *
 * @param {string} targetId - The participant_id to analyze
 * @param {object[]} profiles - Array of all ParsedProfile objects
 * @param {number} [numTrials=100] - Number of Monte Carlo trials
 * @returns {object} { confidence, topPick, runnerUp, runnerUpFrequency, distribution }
 */
export function monteCarloConfidence(targetId, profiles, numTrials = 100) {
  // Find the target profile
  const target = profiles.find(p => p.id === targetId);
  if (!target) throw new Error(`Profile not found: ${targetId}`);

  // Get opposite-gender candidates
  const oppositeGender = target.gender === 'M' ? 'F' : 'M';
  const candidates = profiles.filter(p => p.gender === oppositeGender);

  // Distribution: how often each candidate appeared as #1
  const distribution = {};
  candidates.forEach(c => { distribution[c.id] = 0; });

  for (let trial = 0; trial < numTrials; trial++) {
    // Step 2a: Perturb weights ±20% and renormalize
    const perturbedWeights = perturbWeights(DEFAULT_WEIGHTS);

    // Step 2b: Compute reciprocal scores under perturbed weights
    let bestId = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const result = scoreReciprocal(target, candidate, perturbedWeights);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestId = candidate.id;
      }
    }

    // Step 2c: Record the winner of this trial
    if (bestId) {
      distribution[bestId] = (distribution[bestId] || 0) + 1;
    }
  }

  // Step 3: Find the most frequent top pick and runner-up
  const sorted = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1]);

  const topPick = sorted[0] ? sorted[0][0] : null;
  const topPickCount = sorted[0] ? sorted[0][1] : 0;

  const runnerUp = sorted[1] && sorted[1][1] > 0 ? sorted[1][0] : null;
  const runnerUpFrequency = sorted[1] ? sorted[1][1] / numTrials : 0;

  return {
    confidence: topPickCount / numTrials,
    topPick,
    runnerUp,
    runnerUpFrequency,
    distribution
  };
}

/**
 * Perturb a weights object by ±20% and renormalize to sum to 1.0.
 *
 * Each weight is multiplied by (1 + uniform_random(-0.2, 0.2)),
 * then all weights are divided by their sum so they still form
 * a valid probability distribution.
 *
 * @param {object} baseWeights - The base weights to perturb
 * @returns {object} New weights object with same keys, perturbed and normalized
 */
function perturbWeights(baseWeights) {
  const keys = Object.keys(baseWeights);
  const perturbed = {};

  let sum = 0;
  for (const key of keys) {
    // Uniform random perturbation: multiply by factor in [0.8, 1.2]
    const factor = 1 + (Math.random() * 0.4 - 0.2);
    perturbed[key] = baseWeights[key] * factor;
    sum += perturbed[key];
  }

  // Renormalize so all weights sum to 1.0
  for (const key of keys) {
    perturbed[key] /= sum;
  }

  return perturbed;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 5 — FEATURE ATTRIBUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feature attribution with cohort comparison.
 *
 * For each scoring category, this computes:
 *   - The raw score for the specific candidate
 *   - The AVERAGE score across ALL opposite-gender candidates (the cohort)
 *   - The delta (candidate score - cohort average)
 *
 * A positive delta means this candidate scores above average in that category.
 * A negative delta means below average. This gives context that raw scores
 * alone cannot provide — "72 out of 100" means nothing without knowing
 * the average is 58 (great!) or 85 (below average).
 *
 * @param {string} targetId - The person whose perspective we're analyzing
 * @param {string} candidateId - The specific candidate to compare against cohort
 * @param {object[]} allProfiles - All ParsedProfile objects
 * @returns {object} { categories: Array<{ name, key, score, cohortAvg, delta, weight, weighted }> }
 */
export function getAttribution(targetId, candidateId, allProfiles) {
  const target = allProfiles.find(p => p.id === targetId);
  const candidate = allProfiles.find(p => p.id === candidateId);

  if (!target || !candidate) throw new Error('Profile not found');

  // Step 1: Get the directional score breakdown for this specific candidate
  const candidateResult = scoreDirectional(target, candidate);

  // Step 2: Compute average directional scores across ALL opposite-gender candidates
  const oppositeGender = target.gender === 'M' ? 'F' : 'M';
  const allCandidates = allProfiles.filter(p => p.gender === oppositeGender);

  // Accumulate scores per category
  const categoryKeys = ['lifeGoals', 'values', 'lifestyle', 'loveLanguage', 'interests', 'dealbreaker'];
  const categoryTotals = {};
  categoryKeys.forEach(key => { categoryTotals[key] = 0; });

  for (const c of allCandidates) {
    const result = scoreDirectional(target, c);
    for (const key of categoryKeys) {
      categoryTotals[key] += result.categories[key].score;
    }
  }

  const numCandidates = allCandidates.length;

  // Human-readable category names for display
  const categoryNames = {
    lifeGoals: 'Life Goals & Family',
    values: 'Values & Growth',
    lifestyle: 'Lifestyle Habits',
    loveLanguage: 'Love Language Fit',
    interests: 'Shared Interests',
    dealbreaker: 'Dealbreaker Safety'
  };

  // Step 3: Build the attribution array with deltas
  const categories = categoryKeys.map(key => {
    const score = candidateResult.categories[key].score;
    const cohortAvg = categoryTotals[key] / numCandidates;
    const delta = score - cohortAvg;
    const weight = DEFAULT_WEIGHTS[key];

    return {
      name: categoryNames[key],
      key,
      score,
      cohortAvg: Math.round(cohortAvg * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      weight,
      weighted: score * weight
    };
  });

  return { categories };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — computeAll
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Master computation function. Takes parsed profiles and runs the full pipeline.
 *
 * 1. Computes all pairwise reciprocal scores (male-female pairs only).
 * 2. Runs Gale-Shapley to find the stable matching.
 * 3. For each profile, builds a ranked list of opposite-gender candidates
 *    sorted by reciprocal score descending.
 * 4. Returns a comprehensive result object suitable for the UI layer.
 *
 * @param {object[]} profiles - Array of ParsedProfile objects
 * @returns {object} {
 *   profiles: ParsedProfile[],
 *   stableMatching: Map<string, string>,
 *   rankings: Map<string, Array<{ candidateId, candidateName, reciprocalScore, directionalAB, directionalBA }>>,
 *   pairScores: Map<string, { reciprocal, scoreAB, scoreBA }>
 * }
 */
export function computeAll(profiles) {
  const males = profiles.filter(p => p.gender === 'M');
  const females = profiles.filter(p => p.gender === 'F');

  // Step 1: Compute all pairwise reciprocal scores
  // Key format: 'P01-P03' (sorted ids so each pair appears once)
  const pairScores = new Map();
  for (const m of males) {
    for (const f of females) {
      const result = scoreReciprocal(m, f);
      // Sort ids to create a canonical key
      const key = [m.id, f.id].sort().join('-');
      pairScores.set(key, {
        reciprocal: result.score,
        scoreAB: result.scoreAB,
        scoreBA: result.scoreBA
      });
    }
  }

  // Step 2: Run Gale-Shapley stable matching
  const stableMatching = galeShapley(profiles);

  // Step 3: Build ranked candidate lists for each profile
  const rankings = new Map();

  for (const profile of profiles) {
    const oppositeGender = profile.gender === 'M' ? 'F' : 'M';
    const candidates = profiles.filter(p => p.gender === oppositeGender);

    const ranked = candidates
      .map(candidate => {
        const key = [profile.id, candidate.id].sort().join('-');
        const pairData = pairScores.get(key);

        // Determine which direction is which
        // pairData.scoreAB is always the first profile scored (male in our computation)
        // We need to figure out directional scores from the stored pair
        const dirAB = scoreDirectional(profile, candidate);
        const dirBA = scoreDirectional(candidate, profile);

        return {
          candidateId: candidate.id,
          candidateName: candidate.name,
          reciprocalScore: pairData.reciprocal,
          directionalAB: dirAB.total,
          directionalBA: dirBA.total
        };
      })
      .sort((a, b) => b.reciprocalScore - a.reciprocalScore);

    rankings.set(profile.id, ranked);
  }

  return {
    profiles,
    stableMatching,
    rankings,
    pairScores
  };
}
