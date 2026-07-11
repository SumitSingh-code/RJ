/**
 * app.js — Entry point for Romeo matchmaking engine.
 * Orchestrates data loading, algorithm execution, UI rendering, and LLM calls.
 * Manages provider selection (Claude / Gemini) and API key persistence.
 */

import { rawProfiles } from './data.js';
import { parseAllProfiles } from './parsers.js';
import { computeAll, monteCarloConfidence, getAttribution, scoreDirectional } from './algorithm.js';
import { getVerdict, simulateConversation, PROVIDERS } from './llm.js';
import { renderApp } from './ui.js';

// --------------- localStorage Keys ---------------
const LS_CLAUDE_KEY     = 'romeo_claude_api_key';
const LS_GEMINI_KEY     = 'romeo_gemini_api_key';
const LS_OPENROUTER_KEY = 'romeo_openrouter_api_key';
const LS_PROVIDER       = 'romeo_active_provider';

// --------------- Application State ---------------
const state = {
  profiles: [],
  selectedProfileId: null,
  results: null,
  confidence: null,
  attribution: null,
  verdict: null,
  verdictLoading: false,
  chemistry: null,
  chemistryLoading: false,
  showGraph: false,
  expandedCardId: null,

  // Provider + keys
  activeProvider: localStorage.getItem(LS_PROVIDER) || 'claude',  // 'claude' | 'gemini' | 'openrouter'
  claudeApiKey: localStorage.getItem(LS_CLAUDE_KEY) || '',
  geminiApiKey: localStorage.getItem(LS_GEMINI_KEY) || '',
  openrouterApiKey: localStorage.getItem(LS_OPENROUTER_KEY) || '',

  // Toast notifications
  toast: null  // { message, type: 'error'|'warning'|'info', timestamp }
};

/** Get the API key for the currently active provider */
function getActiveApiKey() {
  if (state.activeProvider === 'claude') return state.claudeApiKey;
  if (state.activeProvider === 'gemini') return state.geminiApiKey;
  if (state.activeProvider === 'openrouter') return state.openrouterApiKey;
  return '';
}

/** Get the display name for the currently active provider */
function getActiveProviderName() {
  return PROVIDERS[state.activeProvider]?.displayName || state.activeProvider;
}

// --------------- Toast Management ---------------
let toastTimer = null;

function showToast(message, type = 'error') {
  state.toast = { message, type, timestamp: Date.now() };
  renderApp(state);

  // Auto-dismiss after 5 seconds
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    renderApp(state);
  }, 5000);
}

function dismissToast() {
  if (toastTimer) clearTimeout(toastTimer);
  state.toast = null;
  renderApp(state);
}

// --------------- Initialization ---------------
function init() {
  try {
    state.profiles = parseAllProfiles();
    state.results = computeAll(state.profiles);
  } catch (err) {
    console.error('[Romeo] Initialization error:', err);
    state.profiles = [];
    state.results = null;
  }
  renderApp(state);
}

// --------------- Profile Selection ---------------
function onProfileSelect(profileId) {
  if (!profileId) {
    state.selectedProfileId = null;
    state.verdict = null;
    state.chemistry = null;
    state.confidence = null;
    state.attribution = null;
    state.expandedCardId = null;
    renderApp(state);
    return;
  }

  state.selectedProfileId = profileId;
  state.verdict = null;
  state.chemistry = null;
  state.expandedCardId = null;

  // Compute confidence and attribution for this user's top pick
  const ranking = state.results?.rankings?.get(profileId);
  if (ranking && ranking.length > 0) {
    try {
      state.confidence = monteCarloConfidence(profileId, state.profiles);
    } catch (err) {
      console.error('[Romeo] Monte Carlo error:', err);
      state.confidence = null;
    }

    try {
      state.attribution = getAttribution(profileId, ranking[0].candidateId, state.profiles);
    } catch (err) {
      console.error('[Romeo] Attribution error:', err);
      state.attribution = null;
    }
  } else {
    state.confidence = null;
    state.attribution = null;
  }

  renderApp(state);

  // Auto-fetch LLM verdict if the active provider has a key
  const activeKey = getActiveApiKey();
  if (activeKey && ranking && ranking.length > 0) {
    fetchVerdict(profileId, ranking[0].candidateId);
  }
}

// --------------- LLM Verdict ---------------
async function fetchVerdict(targetId, candidateId) {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    showToast(`No ${getActiveProviderName()} API key found — add one above to unlock this.`, 'warning');
    return;
  }

  state.verdictLoading = true;
  renderApp(state);

  try {
    const target = state.profiles.find(p => p.id === targetId);
    const candidate = state.profiles.find(p => p.id === candidateId);

    if (!target || !candidate) {
      throw new Error('Profile not found');
    }

    const attribution = state.attribution;
    const ranking = state.results.rankings.get(targetId);
    const reciprocal = ranking?.[0];
    const stablePartner = state.results.stableMatching.get(targetId);
    const isMutuallyOptimal = stablePartner === candidateId;

    let flags = [];
    try {
      flags = scoreDirectional(target, candidate).flags || [];
    } catch (_) { /* non-critical */ }

    const scoreData = {
      reciprocalScore: reciprocal?.reciprocalScore,
      directionalAB: reciprocal?.directionalAB,
      directionalBA: reciprocal?.directionalBA,
      attribution: attribution,
      confidence: state.confidence,
      isMutuallyOptimal: isMutuallyOptimal,
      flags: flags
    };

    state.verdict = await getVerdict(scoreData, target, candidate, state.activeProvider, apiKey);

    // If the LLM returned an error with a reason, show appropriate toast
    if (state.verdict?.error && state.verdict?.reason !== 'missing_key') {
      showToast(state.verdict.message, 'error');
    }
  } catch (e) {
    console.error('[Romeo] Verdict fetch error:', e);
    state.verdict = { error: true, message: 'Narrative layer temporarily unavailable' };
  }

  state.verdictLoading = false;
  renderApp(state);
}

// --------------- Chemistry Simulation ---------------
async function fetchChemistry(targetId, candidateId) {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    showToast(`No ${getActiveProviderName()} API key found — add one above to unlock this.`, 'warning');
    return;
  }

  state.chemistryLoading = true;
  renderApp(state);

  try {
    const target = state.profiles.find(p => p.id === targetId);
    const candidate = state.profiles.find(p => p.id === candidateId);

    if (!target || !candidate) {
      throw new Error('Profile not found');
    }

    let attribution = state.attribution;
    if (!attribution) {
      try {
        attribution = getAttribution(targetId, candidateId, state.profiles);
      } catch (_) { /* non-critical */ }
    }

    state.chemistry = await simulateConversation(target, candidate, attribution, state.activeProvider, apiKey);

    // If the LLM returned an error with a reason, show appropriate toast
    if (state.chemistry?.error && state.chemistry?.reason !== 'missing_key') {
      showToast(state.chemistry.message, 'error');
    }
  } catch (e) {
    console.error('[Romeo] Chemistry simulation error:', e);
    state.chemistry = { error: true, message: 'Chemistry simulation temporarily unavailable' };
  }

  state.chemistryLoading = false;
  renderApp(state);
}

// --------------- Provider & Key Management ---------------

function setActiveProvider(provider) {
  if (!['claude', 'gemini', 'openrouter'].includes(provider)) return;
  state.activeProvider = provider;
  localStorage.setItem(LS_PROVIDER, provider);

  // Clear previous LLM results when switching providers
  state.verdict = null;
  state.chemistry = null;

  // Dismiss any lingering missing-key toast
  if (state.toast) {
    state.toast = null;
  }

  renderApp(state);
}

function setClaudeApiKey(key) {
  state.claudeApiKey = key;
  localStorage.setItem(LS_CLAUDE_KEY, key);
  if (state.activeProvider === 'claude' && key && state.toast) state.toast = null;
}

function setGeminiApiKey(key) {
  state.geminiApiKey = key;
  localStorage.setItem(LS_GEMINI_KEY, key);
  if (state.activeProvider === 'gemini' && key && state.toast) state.toast = null;
}

function setOpenrouterApiKey(key) {
  state.openrouterApiKey = key;
  localStorage.setItem(LS_OPENROUTER_KEY, key);
  if (state.activeProvider === 'openrouter' && key && state.toast) state.toast = null;
}

// --------------- Global API for UI Event Binding ---------------
window.Romeo = {
  onProfileSelect,
  fetchVerdict,
  fetchChemistry,
  dismissToast,

  toggleGraph: () => {
    state.showGraph = !state.showGraph;
    renderApp(state);
  },

  setActiveProvider,
  setClaudeApiKey,
  setGeminiApiKey,
  setOpenrouterApiKey,

  expandCard: (id) => {
    state.expandedCardId = state.expandedCardId === id ? null : id;

    // Compute attribution for the expanded card
    if (state.expandedCardId && state.selectedProfileId) {
      try {
        state.attribution = getAttribution(state.selectedProfileId, id, state.profiles);
      } catch (err) {
        console.error('[Romeo] Attribution error:', err);
      }
    }

    renderApp(state);
  },

  getState: () => state
};

// --------------- Boot ---------------
init();
