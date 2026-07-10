/**
 * parsers.js — Structured signal extraction from free-text CSV fields.
 *
 * This module converts raw CSV profile objects into structured ParsedProfile
 * objects using exact phrase matching. No LLM, no fuzzy matching — just
 * deterministic string lookups against known vocabulary.
 *
 * Exports:
 *   - parseProfile(raw)     → single ParsedProfile
 *   - parseAllProfiles()    → array of all ParsedProfiles
 */

import { rawProfiles } from './data.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOVE LANGUAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the love_language column into one of the canonical 5 love languages.
 *
 * The CSV uses the standard names directly:
 *   'Physical Touch'        → 'physical_touch'
 *   'Words of Affirmation'  → 'words_of_affirmation'
 *   'Acts of Service'       → 'acts_of_service'
 *   'Quality Time'          → 'quality_time'
 *   'Gifts'                 → 'gifts'
 *
 * @param {string} text - The raw love_language value
 * @returns {string} Canonical love language key
 */
function parseLoveLanguage(text) {
  if (text === 'Physical Touch') return 'physical_touch';
  if (text === 'Words of Affirmation') return 'words_of_affirmation';
  if (text === 'Acts of Service') return 'acts_of_service';
  if (text === 'Quality Time') return 'quality_time';
  if (text === 'Gifts') return 'gifts';
  return 'unknown';
}

/**
 * Parse the shows_care_via column into one of the canonical 5 love languages.
 *
 * This field describes HOW a person expresses care (what they GIVE), as
 * opposed to love_language which is what they want to RECEIVE.
 *
 * Mapping rules — match by key phrase:
 *   'physical gestures' or 'sitting close'       → 'physical_touch'
 *   'tell them, out loud' or 'compliment'         → 'words_of_affirmation'
 *   'show up and do things'                       → 'acts_of_service'
 *   'undistracted time' or 'phones away'          → 'quality_time'
 *   'surprise them with something'                → 'gifts'
 *
 * @param {string} text - The raw shows_care_via value
 * @returns {string} Canonical love language key
 */
function parseShowsCareVia(text) {
  const lower = text.toLowerCase();
  if (lower.includes('physical gestures') || lower.includes('sitting close')) return 'physical_touch';
  if (lower.includes('tell them, out loud') || lower.includes('compliment')) return 'words_of_affirmation';
  if (lower.includes('show up and do things')) return 'acts_of_service';
  if (lower.includes('undistracted time') || lower.includes('phones away')) return 'quality_time';
  if (lower.includes('surprise them with something')) return 'gifts';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATIONSHIP GOAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the relationship_goal column into a canonical intent.
 *
 * Mapping rules:
 *   Contains 'here for marriage'                              → 'marriage'
 *   Contains 'long-term and serious' or 'marriage down the line' → 'serious'
 *   Contains 'keeping it open' or 'letting things develop'    → 'open'
 *
 * @param {string} text - The raw relationship_goal value
 * @returns {string} 'marriage' | 'serious' | 'open'
 */
function parseRelationshipGoal(text) {
  const lower = text.toLowerCase();
  if (lower.includes('here for marriage')) return 'marriage';
  if (lower.includes('long-term and serious') || lower.includes('marriage down the line')) return 'serious';
  if (lower.includes('keeping it open') || lower.includes('letting things develop')) return 'open';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILDREN PREFERENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the children_preference column.
 *
 * Mapping rules:
 *   Contains 'does not want'                         → 'does_not_want'
 *   Contains 'wants children'                        → 'wants'
 *   Contains 'open either way' or 'already co-parenting' → 'open'
 *
 * @param {string} text - The raw children_preference value
 * @returns {string} 'wants' | 'open' | 'does_not_want'
 */
function parseChildrenPreference(text) {
  const lower = text.toLowerCase();
  if (lower.includes('does not want')) return 'does_not_want';
  if (lower.includes('wants children')) return 'wants';
  if (lower.includes('open either way') || lower.includes('already co-parenting')) return 'open';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOKING / DRINKING / DIET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the smoking_habit column into a boolean.
 *
 * Mapping rules:
 *   Contains 'occasional smoker'  → true  (they do smoke, even if socially)
 *   Contains 'non-smoker'         → false
 *
 * @param {string} text - The raw smoking_habit value
 * @returns {boolean} true if they smoke (even occasionally)
 */
function parseIsSmoker(text) {
  const lower = text.toLowerCase();
  if (lower.includes('occasional smoker')) return true;
  if (lower.includes('non-smoker')) return false;
  return false;
}

/**
 * Parse the drinking_habit column.
 *
 * Mapping rules:
 *   Contains 'non-drinker'    → 'none'
 *   Contains 'social drinker' → 'social'
 *
 * @param {string} text - The raw drinking_habit value
 * @returns {string} 'none' | 'social'
 */
function parseDrinkingHabit(text) {
  const lower = text.toLowerCase();
  if (lower.includes('non-drinker')) return 'none';
  if (lower.includes('social drinker')) return 'social';
  return 'unknown';
}

/**
 * Parse the diet column.
 *
 * Mapping rules:
 *   Starts with 'Non-vegetarian' → 'non_vegetarian'
 *   'Vegetarian'                 → 'vegetarian'
 *
 * We check for 'Non-vegetarian' first because it also contains 'Vegetarian'.
 *
 * @param {string} text - The raw diet value
 * @returns {string} 'vegetarian' | 'non_vegetarian'
 */
function parseDiet(text) {
  if (text.startsWith('Non-vegetarian')) return 'non_vegetarian';
  if (text === 'Vegetarian') return 'vegetarian';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE VALUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the core_value column into one of ~9 canonical trait values.
 *
 * The CSV text typically reads "Probably being [trait] -- ..." so we
 * match on key phrases within that text.
 *
 * Mapping rules (checked in order):
 *   Contains 'family-oriented' or 'family comes first' → 'family_oriented'
 *   Contains 'loyal'                                    → 'loyal'
 *   Contains 'ambitious' or 'driven'                    → 'ambitious'
 *   Contains 'independent'                              → 'independent'
 *   Contains 'creative'                                 → 'creative'
 *   Contains 'intellectual' or 'good debate'            → 'intellectual'
 *   Contains 'adventurous' or 'restless'                → 'adventurous'
 *   Contains 'compassionate'                            → 'compassionate'
 *   Contains 'spiritual'                                → 'spiritual'
 *
 * @param {string} text - The raw core_value value
 * @returns {string} Canonical core value trait
 */
function parseCoreValue(text) {
  const lower = text.toLowerCase();
  if (lower.includes('family-oriented') || lower.includes('family comes first')) return 'family_oriented';
  if (lower.includes('loyal')) return 'loyal';
  if (lower.includes('ambitious') || lower.includes('driven')) return 'ambitious';
  if (lower.includes('independent')) return 'independent';
  if (lower.includes('creative')) return 'creative';
  if (lower.includes('intellectual') || lower.includes('good debate')) return 'intellectual';
  if (lower.includes('adventurous') || lower.includes('restless')) return 'adventurous';
  if (lower.includes('compassionate')) return 'compassionate';
  if (lower.includes('spiritual')) return 'spiritual';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-IMPROVEMENT TARGET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the self_improvement_area column to extract the trait they're
 * actively growing toward.
 *
 * The CSV text typically reads "... being a bit more [trait] instead of ..."
 * We match on 'more [trait]' to extract the growth direction.
 *
 * Mapping rules:
 *   Contains 'more ambitious'       → 'ambitious'
 *   Contains 'more family-oriented' → 'family_oriented'
 *   Contains 'more creative'        → 'creative'
 *   Contains 'more loyal'           → 'loyal'
 *   Contains 'more compassionate'   → 'compassionate'
 *   Contains 'more adventurous'     → 'adventurous'
 *   Contains 'more spiritual'       → 'spiritual'
 *   Contains 'more intellectual'    → 'intellectual'
 *   Contains 'more independent'     → 'independent'
 *
 * @param {string} text - The raw self_improvement_area value
 * @returns {string} Canonical trait the person aspires to
 */
function parseSelfImprovementTarget(text) {
  const lower = text.toLowerCase();
  if (lower.includes('more ambitious')) return 'ambitious';
  if (lower.includes('more family-oriented')) return 'family_oriented';
  if (lower.includes('more creative')) return 'creative';
  if (lower.includes('more loyal')) return 'loyal';
  if (lower.includes('more compassionate')) return 'compassionate';
  if (lower.includes('more adventurous')) return 'adventurous';
  if (lower.includes('more spiritual')) return 'spiritual';
  if (lower.includes('more intellectual')) return 'intellectual';
  if (lower.includes('more independent')) return 'independent';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// DEALBREAKERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the deal_breaker column to extract exactly 2 triggers from a
 * fixed vocabulary of 5 possible dealbreakers.
 *
 * Each person's deal_breaker text mentions exactly 2 of these triggers.
 * We check for all 5 and return whichever ones match.
 *
 * Fixed vocabulary of 5 triggers:
 *   'smoking'                → matched by 'smoking' or 'smoking is a hard no'
 *   'heavy_drinking'         → matched by 'heavy drinking'
 *   'avoidant_conflict'      → matched by 'shuts down instead of talking'
 *   'lack_of_ambition'       → matched by 'no drive or direction'
 *   'mismatched_life_goals'  → matched by 'different things out of life' or
 *                              'completely different things'
 *
 * @param {string} text - The raw deal_breaker value
 * @returns {string[]} Array of 2 dealbreaker trigger keys
 */
function parseDealbreakers(text) {
  const lower = text.toLowerCase();
  const result = [];

  if (lower.includes('smoking') || lower.includes('smoking is a hard no')) {
    result.push('smoking');
  }
  if (lower.includes('heavy drinking')) {
    result.push('heavy_drinking');
  }
  if (lower.includes('shuts down instead of talking')) {
    result.push('avoidant_conflict');
  }
  if (lower.includes('no drive or direction')) {
    result.push('lack_of_ambition');
  }
  if (lower.includes('different things out of life') || lower.includes('completely different things')) {
    result.push('mismatched_life_goals');
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT STYLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the conflict_style column into a binary classification.
 *
 * Mapping rules:
 *   Contains 'easygoing' or 'easygoing and warm' → 'easygoing'
 *   Contains 'straight shooter'                   → 'direct'
 *
 * @param {string} text - The raw conflict_style value
 * @returns {string} 'easygoing' | 'direct'
 */
function parseConflictStyle(text) {
  const lower = text.toLowerCase();
  if (lower.includes('easygoing')) return 'easygoing';
  if (lower.includes('straight shooter')) return 'direct';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING STYLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the planning_style column.
 *
 * Mapping rules:
 *   Contains 'like routine'                          → 'routine'
 *   Contains 'bored easily' or 'mixing things up'   → 'spontaneous'
 *
 * @param {string} text - The raw planning_style value
 * @returns {string} 'routine' | 'spontaneous'
 */
function parsePlanningStyle(text) {
  const lower = text.toLowerCase();
  if (lower.includes('like routine')) return 'routine';
  if (lower.includes('bored easily') || lower.includes('mixing things up')) return 'spontaneous';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL STYLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the social_style column into extrovert/introvert.
 *
 * Mapping rules:
 *   Contains 'lights up a room'           → 'extrovert'
 *   Contains 'quieter' or 'one-on-one'    → 'introvert'
 *
 * @param {string} text - The raw social_style value
 * @returns {string} 'extrovert' | 'introvert'
 */
function parseSocialStyle(text) {
  const lower = text.toLowerCase();
  if (lower.includes('lights up a room')) return 'extrovert';
  if (lower.includes('quieter') || lower.includes('one-on-one')) return 'introvert';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY IMPORTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the family_importance column.
 *
 * Mapping rules:
 *   Contains 'family comes first'                                 → 'high'
 *   Contains 'fair amount' or 'check in with them regularly'      → 'moderate'
 *
 * @param {string} text - The raw family_importance value
 * @returns {string} 'high' | 'moderate'
 */
function parseFamilyImportance(text) {
  const lower = text.toLowerCase();
  if (lower.includes('family comes first')) return 'high';
  if (lower.includes('fair amount') || lower.includes('check in with them regularly')) return 'moderate';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY TAGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract up to 3 canonical activity tags from three free-text fields:
 *   - favorite_hobby
 *   - perfect_sunday
 *   - ideal_getaway
 *
 * Canonical tag vocabulary and their matching phrases:
 *   'travel'       → 'hopping on a flight' or 'flight somewhere'
 *   'dance'        → 'excuse to dance'
 *   'gaming'       → 'lost in a good game'
 *   'reading'      → 'lost in a good book'
 *   'cooking'      → 'recipe in the kitchen'
 *   'photography'  → 'camera' or 'worth shooting'
 *   'art'          → 'gallery' or 'sketching'
 *   'fitness'      → 'gym session' or 'long run'
 *   'volunteering' → 'volunteering'
 *   'live_music'   → 'live gig'
 *   'hiking'       → 'trail I haven\'t done'
 *
 * Tags are extracted from all 3 fields, deduplicated, and capped at 3.
 *
 * @param {string} hobby    - The raw favorite_hobby value
 * @param {string} sunday   - The raw perfect_sunday value
 * @param {string} getaway  - The raw ideal_getaway value
 * @returns {string[]} Array of up to 3 canonical activity tags
 */
function parseActivityTags(hobby, sunday, getaway) {
  // Combine all three fields for scanning
  const combined = [hobby, sunday, getaway].join(' ').toLowerCase();

  const tags = new Set();

  // Each check: scan for the key phrase and add the canonical tag
  if (combined.includes('hopping on a flight') || combined.includes('flight somewhere')) {
    tags.add('travel');
  }
  if (combined.includes('excuse to dance')) {
    tags.add('dance');
  }
  if (combined.includes('lost in a good game')) {
    tags.add('gaming');
  }
  if (combined.includes('lost in a good book')) {
    tags.add('reading');
  }
  if (combined.includes('recipe in the kitchen')) {
    tags.add('cooking');
  }
  if (combined.includes('camera') || combined.includes('worth shooting')) {
    tags.add('photography');
  }
  if (combined.includes('gallery') || combined.includes('sketching')) {
    tags.add('art');
  }
  if (combined.includes('gym session') || combined.includes('long run')) {
    tags.add('fitness');
  }
  if (combined.includes('volunteering')) {
    tags.add('volunteering');
  }
  if (combined.includes('live gig')) {
    tags.add('live_music');
  }
  if (combined.includes("trail i haven't done")) {
    tags.add('hiking');
  }

  // Return deduplicated array, capped at 3 tags
  return Array.from(tags).slice(0, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a raw CSV profile object into a structured ParsedProfile.
 *
 * This is the master parsing function that orchestrates all the individual
 * parsers above. It produces a fully structured object suitable for the
 * matchmaking algorithm.
 *
 * @param {object} raw - A raw profile object from data.js (one element of rawProfiles)
 * @returns {object} ParsedProfile with structured fields
 */
export function parseProfile(raw) {
  return {
    // ── Identity fields (pass-through) ──
    id: raw.participant_id,
    name: raw.name,
    age: parseInt(raw.age, 10),       // Convert string age to number
    gender: raw.gender,               // 'M' or 'F'
    city: raw.city,
    occupation: raw.occupation,
    education: raw.education,
    income: raw.annual_income,

    // ── Parsed structured fields ──
    relationshipGoal: parseRelationshipGoal(raw.relationship_goal),
    childrenPreference: parseChildrenPreference(raw.children_preference),
    isSmoker: parseIsSmoker(raw.smoking_habit),
    drinkingHabit: parseDrinkingHabit(raw.drinking_habit),
    diet: parseDiet(raw.diet),
    loveLanguage: parseLoveLanguage(raw.love_language),
    showsCareVia: parseShowsCareVia(raw.shows_care_via),
    coreValue: parseCoreValue(raw.core_value),
    selfImprovementTarget: parseSelfImprovementTarget(raw.self_improvement_area),
    dealbreakers: parseDealbreakers(raw.deal_breaker),
    conflictStyle: parseConflictStyle(raw.conflict_style),
    planningStyle: parsePlanningStyle(raw.planning_style),
    socialStyle: parseSocialStyle(raw.social_style),
    familyImportance: parseFamilyImportance(raw.family_importance),
    activityTags: parseActivityTags(
      raw.favorite_hobby,
      raw.perfect_sunday,
      raw.ideal_getaway
    ),

    // ── Keep original raw data for reference ──
    raw
  };
}

/**
 * Parse all 20 raw profiles into structured ParsedProfile objects.
 *
 * Convenience function that maps parseProfile over every element in
 * the rawProfiles array from data.js.
 *
 * @returns {object[]} Array of 20 ParsedProfile objects
 */
export function parseAllProfiles() {
  return rawProfiles.map(parseProfile);
}
