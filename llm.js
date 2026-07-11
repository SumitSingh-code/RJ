/**
 * llm.js — Provider-agnostic LLM integration for Romeo matchmaking engine.
 * Supports Claude (Anthropic), Gemini (Google), and OpenRouter via a unified callLLM() interface.
 * Both getVerdict() and simulateConversation() route through callLLM(), which
 * dispatches to the correct provider adapter based on the active selection.
 */

const TIMEOUT_MS = 30000;

// ====================================================================
// PROVIDER CONFIGURATION
// Each provider defines: display name, how to build requests, how to
// extract text from responses. The two APIs have different shapes —
// this is a real adapter, not a shared-format assumption.
// ====================================================================

export const PROVIDERS = {
  claude: {
    id: 'claude',
    displayName: 'Claude',
    model: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com/v1/messages',

    /** Build fetch options for Claude /v1/messages */
    buildRequest(apiKey, systemPrompt, userPrompt) {
      return {
        url: this.endpoint,
        options: {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
          })
        }
      };
    },

    /** Extract text content from Claude's response JSON */
    extractText(responseData) {
      if (responseData.content && Array.isArray(responseData.content)) {
        const textBlock = responseData.content.find(b => b.type === 'text');
        if (textBlock) return textBlock.text;
      }
      return null;
    }
  },

  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    // NOTE: Update this model string if Google deprecates it or a newer version is available.
    // Check https://ai.google.dev/models for current model names.
    // gemini-2.0-flash is the current recommended fast model as of mid-2025.
    model: 'gemini-2.0-flash',
    endpointTemplate: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}',

    /** Build fetch options for Gemini generateContent */
    buildRequest(apiKey, systemPrompt, userPrompt) {
      const url = this.endpointTemplate
        .replace('{model}', this.model)
        .replace('{apiKey}', encodeURIComponent(apiKey));

      return {
        url,
        options: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // Gemini uses systemInstruction for system-level prompts
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [{
              parts: [{ text: userPrompt }]
            }],
            generationConfig: {
              // Use Gemini's native JSON mode for cleaner output
              responseMimeType: 'application/json',
              temperature: 0.7,
              maxOutputTokens: 1024
            }
          })
        }
      };
    },

    /** Extract text content from Gemini's response JSON */
    extractText(responseData) {
      // Gemini response shape: { candidates: [{ content: { parts: [{ text }] } }] }
      if (responseData.candidates && responseData.candidates.length > 0) {
        const parts = responseData.candidates[0]?.content?.parts;
        if (parts && parts.length > 0) {
          return parts[0].text;
        }
      }
      return null;
    }
  },

  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    // OpenRouter routes to many models; using a fast, free-tier-friendly default.
    // Users can change this if they have credits for premium models.
    model: 'google/gemini-2.0-flash-001',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',

    /** Build fetch options for OpenRouter (OpenAI-compatible format) */
    buildRequest(apiKey, systemPrompt, userPrompt) {
      return {
        url: this.endpoint,
        options: {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'HTTP-Referer': window.location.origin || 'https://romeo-matchmaking.vercel.app',
            'X-Title': 'Romeo Matchmaking Engine'
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 1024,
            temperature: 0.7,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          })
        }
      };
    },

    /** Extract text content from OpenRouter's response (OpenAI-compatible format) */
    extractText(responseData) {
      // OpenAI format: { choices: [{ message: { content: "..." } }] }
      if (responseData.choices && responseData.choices.length > 0) {
        return responseData.choices[0]?.message?.content || null;
      }
      return null;
    }
  }
};

// ====================================================================
// JSON EXTRACTION (shared fallback for both providers)
// Direct parse → brace-match → bracket-match
// ====================================================================

function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Direct parse
  try {
    return JSON.parse(text);
  } catch (_) { /* continue */ }

  // Regex: find the outermost { ... }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (_) { /* continue */ }
  }

  // Regex: find the outermost [ ... ]
  const bracketMatch = text.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    try {
      return JSON.parse(bracketMatch[0]);
    } catch (_) { /* continue */ }
  }

  return null;
}

// ====================================================================
// UNIFIED LLM CALL
// Routes to the correct provider adapter. Returns normalized shape:
//   { ok: true,  data: <parsed JSON> }
//   { ok: false, reason: "missing_key"|"request_failed"|"bad_response", message: string }
// ====================================================================

/**
 * @param {{ provider: string, apiKey: string, systemPrompt: string, userPrompt: string }} params
 * @returns {Promise<{ ok: boolean, data?: object, reason?: string, message?: string }>}
 */
export async function callLLM({ provider, apiKey, systemPrompt, userPrompt }) {
  // 1. Validate provider
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    return { ok: false, reason: 'request_failed', message: `Unknown provider: ${provider}` };
  }

  // 2. Check API key
  if (!apiKey || apiKey.trim() === '') {
    return {
      ok: false,
      reason: 'missing_key',
      message: `No ${providerConfig.displayName} API key found — add one above to unlock this.`
    };
  }

  // 3. Build and send request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { url, options } = providerConfig.buildRequest(apiKey, systemPrompt, userPrompt);
    options.signal = controller.signal;

    const response = await fetch(url, options);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const status = response.status;

      // Distinguish between auth errors and other failures
      if (status === 401 || status === 403) {
        return {
          ok: false,
          reason: 'request_failed',
          message: `Invalid ${providerConfig.displayName} API key. Check your key and try again.`
        };
      }
      if (status === 429) {
        return {
          ok: false,
          reason: 'request_failed',
          message: `${providerConfig.displayName} rate limit reached. Please wait a moment and try again.`
        };
      }

      return {
        ok: false,
        reason: 'request_failed',
        message: `${providerConfig.displayName} API error (${status}): ${errorBody.slice(0, 150)}`
      };
    }

    const responseData = await response.json();

    // 4. Extract text using provider-specific adapter
    const rawText = providerConfig.extractText(responseData);
    if (!rawText) {
      return { ok: false, reason: 'bad_response', message: 'Unexpected response format from LLM.' };
    }

    // 5. Parse JSON from the extracted text (shared fallback logic)
    const parsed = extractJSON(rawText);
    if (!parsed) {
      return { ok: false, reason: 'bad_response', message: 'Could not parse JSON from LLM response.' };
    }

    return { ok: true, data: parsed };

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'request_failed', message: 'Request timed out after 30 seconds.' };
    }
    return {
      ok: false,
      reason: 'request_failed',
      message: `Network error: ${err.message}`
    };
  }
}

// ====================================================================
// PROFILE SUMMARY (shared utility for LLM context)
// ====================================================================

function profileSummary(profile) {
  return {
    name: profile.name,
    age: profile.age,
    gender: profile.gender,
    city: profile.city,
    occupation: profile.occupation,
    education: profile.education,
    relationshipGoal: profile.relationshipGoal,
    childrenPreference: profile.childrenPreference,
    loveLanguage: profile.loveLanguage,
    showsCareVia: profile.showsCareVia,
    coreValue: profile.coreValue,
    selfImprovementTarget: profile.selfImprovementTarget,
    conflictStyle: profile.conflictStyle,
    planningStyle: profile.planningStyle,
    socialStyle: profile.socialStyle,
    familyImportance: profile.familyImportance,
    activityTags: profile.activityTags,
    dealbreakers: profile.dealbreakers,
    isSmoker: profile.isSmoker,
    drinkingHabit: profile.drinkingHabit,
    diet: profile.diet
  };
}

// ====================================================================
// getVerdict — LLM-powered match analysis
// ====================================================================

/**
 * @param {object} scoreData — computed compatibility data
 * @param {object} profileA — target ParsedProfile
 * @param {object} profileB — candidate ParsedProfile
 * @param {string} provider — 'claude' | 'gemini'
 * @param {string} apiKey — API key for the selected provider
 * @returns {Promise<{ headline, verdict, conversation_starter } | { error, message, reason }>}
 */
export async function getVerdict(scoreData, profileA, profileB, provider, apiKey) {
  const systemPrompt = `You are Romeo, a matchmaking analyst. You MUST respond with valid JSON only. You receive computed compatibility data. Your job is to turn these numbers into readable prose. NEVER invent any number, score, or ranking that was not provided to you. Only reference the specific computed facts given.

Response format:
{
  "headline": "A short compelling headline about this match",
  "verdict": "2-3 sentences referencing the specific computed facts (scores, dealbreakers, confidence). Must mention at least one specific number from the data.",
  "conversation_starter": "A suggested opening line based on their shared interests or values"
}`;

  const userPrompt = JSON.stringify({
    compatibility_data: {
      reciprocal_score: scoreData.reciprocalScore,
      directional_score_A_to_B: scoreData.directionalAB,
      directional_score_B_to_A: scoreData.directionalBA,
      is_mutually_optimal_stable_match: scoreData.isMutuallyOptimal,
      monte_carlo_confidence: scoreData.confidence?.confidence,
      dealbreaker_flags: scoreData.flags,
      attribution_categories: scoreData.attribution?.categories?.map(c => ({
        category: c.name,
        score: c.score,
        cohort_average: c.cohortAvg,
        delta: c.delta,
        weight: c.weight
      }))
    },
    target_profile: profileSummary(profileA),
    candidate_profile: profileSummary(profileB)
  }, null, 2);

  const result = await callLLM({ provider, apiKey, systemPrompt, userPrompt });

  if (!result.ok) {
    return { error: true, message: result.message, reason: result.reason };
  }

  const parsed = result.data;
  if (parsed.headline && parsed.verdict) {
    return {
      headline: parsed.headline,
      verdict: parsed.verdict,
      conversation_starter: parsed.conversation_starter || ''
    };
  }

  return { error: true, message: 'Narrative layer temporarily unavailable', reason: 'bad_response' };
}

// ====================================================================
// simulateConversation — Chemistry Simulator (PS2)
// ====================================================================

/**
 * @param {object} profileA — ParsedProfile
 * @param {object} profileB — ParsedProfile
 * @param {object} attribution — Layer 5 attribution data
 * @param {string} provider — 'claude' | 'gemini'
 * @param {string} apiKey — API key for the selected provider
 * @returns {Promise<{ dialogue, summary, sparkScore } | { error, message, reason }>}
 */
export async function simulateConversation(profileA, profileB, attribution, provider, apiKey) {
  // Find the weakest compatibility category
  let lowestCategory = null;
  if (attribution?.categories && attribution.categories.length > 0) {
    lowestCategory = attribution.categories.reduce((min, cat) =>
      cat.score < min.score ? cat : min
    , attribution.categories[0]);
  }

  const systemPrompt = `You are a relationship dynamics simulator. Simulate a realistic first-date conversation (8-10 exchanges) between two people based on their real profiles. IMPORTANT: You must specifically address their WEAKEST compatibility area (provided as lowest_attribution_category) in at least one exchange — this should surface naturally as a point of tension or discovery. Tag each line as spark/neutral/friction. End with a chemistry summary. Respond in JSON only.

Response format:
{
  "dialogue": [
    { "speaker": "Name", "line": "...", "tag": "neutral|spark|friction" }
  ],
  "summary": "A 2-3 sentence chemistry read",
  "sparkScore": 7.5
}`;

  const userPrompt = JSON.stringify({
    person_a: {
      ...profileSummary(profileA),
      income: profileA.income
    },
    person_b: {
      ...profileSummary(profileB),
      income: profileB.income
    },
    lowest_attribution_category: lowestCategory ? {
      name: lowestCategory.name,
      key: lowestCategory.key,
      score: lowestCategory.score,
      cohort_average: lowestCategory.cohortAvg,
      delta: lowestCategory.delta
    } : null,
    context: `${profileA.name} and ${profileB.name} are meeting for the first time. Their overall compatibility was scored algorithmically. The weakest area is ${lowestCategory?.name || 'unknown'}.`
  }, null, 2);

  const result = await callLLM({ provider, apiKey, systemPrompt, userPrompt });

  if (!result.ok) {
    return { error: true, message: result.message, reason: result.reason };
  }

  const parsed = result.data;
  if (parsed.dialogue && Array.isArray(parsed.dialogue)) {
    return {
      dialogue: parsed.dialogue,
      summary: parsed.summary || '',
      sparkScore: typeof parsed.sparkScore === 'number' ? parsed.sparkScore : 0
    };
  }

  return { error: true, message: 'Chemistry simulation temporarily unavailable', reason: 'bad_response' };
}
