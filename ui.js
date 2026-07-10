/**
 * ui.js — DOM rendering module for Romeo matchmaking engine.
 * All visual rendering logic. Takes computed state, outputs DOM.
 */

// --------------- Utilities ---------------

/** Format a number to 1 decimal place */
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(1);
}

/** Escape HTML to prevent XSS */
function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

/** Clamp a value between 0–100 for bar widths */
function clamp100(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

// --------------- Render: Header ---------------

function renderHeader() {
  return `
    <header class="header">
      <h1 class="header-brand">Romeo</h1>
      <p class="header-subtitle">Algorithm-First Matchmaking Engine</p>
    </header>`;
}

// --------------- Render: Controls ---------------

function renderControls(state) {
  const profiles = state.profiles || [];
  const selectedId = state.selectedProfileId || '';
  const activeProvider = state.activeProvider || 'claude';
  const claudeKey = state.claudeApiKey || '';
  const geminiKey = state.geminiApiKey || '';

  const options = profiles.map(p =>
    `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)} (${esc(p.age)}, ${esc(p.city)})</option>`
  ).join('');

  // Ready indicators
  const claudeReady = claudeKey.trim().length > 0;
  const geminiReady = geminiKey.trim().length > 0;

  return `
    <nav class="controls-bar" aria-label="Controls">
      <select
        id="profile-selector"
        class="profile-selector"
        onchange="window.Romeo.onProfileSelect(this.value)"
        aria-label="Select a profile to analyze"
      >
        <option value="">Select a profile to analyze…</option>
        ${options}
      </select>

      <div class="provider-controls">
        <!-- Segmented provider toggle -->
        <div class="provider-toggle" role="radiogroup" aria-label="LLM Provider">
          <button
            id="provider-toggle-claude"
            class="provider-toggle-btn ${activeProvider === 'claude' ? 'active' : ''}"
            onclick="window.Romeo.setActiveProvider('claude')"
            role="radio"
            aria-checked="${activeProvider === 'claude'}"
          >Claude</button>
          <button
            id="provider-toggle-gemini"
            class="provider-toggle-btn ${activeProvider === 'gemini' ? 'active' : ''}"
            onclick="window.Romeo.setActiveProvider('gemini')"
            role="radio"
            aria-checked="${activeProvider === 'gemini'}"
          >Gemini</button>
        </div>

        <!-- Dual API key inputs -->
        <div class="api-keys-row">
          <div class="api-key-wrapper">
            <input
              id="api-key-claude"
              class="api-key-input ${activeProvider === 'claude' ? 'active-provider-input' : ''}"
              type="password"
              placeholder="Claude API key"
              value="${esc(claudeKey)}"
              oninput="window.Romeo.setClaudeApiKey(this.value)"
              aria-label="Claude API key"
            />
            <span class="key-ready-dot ${claudeReady ? 'ready' : ''}" title="${claudeReady ? 'Key entered' : 'No key'}"></span>
            <button class="key-toggle-vis" onclick="this.parentElement.querySelector('input').type = this.parentElement.querySelector('input').type === 'password' ? 'text' : 'password'" aria-label="Toggle key visibility" title="Show/hide key">👁</button>
          </div>
          <div class="api-key-wrapper">
            <input
              id="api-key-gemini"
              class="api-key-input ${activeProvider === 'gemini' ? 'active-provider-input' : ''}"
              type="password"
              placeholder="Gemini API key"
              value="${esc(geminiKey)}"
              oninput="window.Romeo.setGeminiApiKey(this.value)"
              aria-label="Gemini API key"
            />
            <span class="key-ready-dot ${geminiReady ? 'ready' : ''}" title="${geminiReady ? 'Key entered' : 'No key'}"></span>
            <button class="key-toggle-vis" onclick="this.parentElement.querySelector('input').type = this.parentElement.querySelector('input').type === 'password' ? 'text' : 'password'" aria-label="Toggle key visibility" title="Show/hide key">👁</button>
          </div>
        </div>
      </div>
    </nav>`;
}

// --------------- Render: Welcome ---------------

function renderWelcome() {
  return `
    <section class="welcome-message" aria-label="Welcome">
      <h2>Select a profile to begin</h2>
      <p>Choose a user from the dropdown above to see their algorithmically ranked matches, 
         Gale-Shapley stable pairing, Monte Carlo confidence analysis, and AI-powered chemistry insights.</p>
    </section>`;
}

// --------------- Render: Target Brief ---------------

function renderTargetBrief(profile) {
  if (!profile) return '';
  return `
    <section class="target-brief" aria-label="Selected profile">
      <div class="target-label">Analyzing compatibility for</div>
      <h2>${esc(profile.name)}</h2>
      <div class="target-meta">
        ${esc(profile.age)} · ${esc(profile.city)} · ${esc(profile.occupation)} · Goal: ${esc(profile.relationshipGoal)}
      </div>
    </section>`;
}

// --------------- Render: Score Bars ---------------

function renderScoreBars(reciprocal, dirAB, dirBA, targetName, candidateName) {
  return `
    <div class="score-bars-group">
      <div class="score-bar-row">
        <span class="score-bar-label">Reciprocal</span>
        <div class="score-bar-track">
          <div class="score-bar">
            <div class="score-bar-fill" style="--bar-width: ${clamp100(reciprocal)}%; width: ${clamp100(reciprocal)}%"></div>
          </div>
        </div>
        <span class="score-bar-value">${fmt(reciprocal)}</span>
      </div>
      <div class="score-bar-row">
        <span class="score-bar-label">${esc(targetName)} → ${esc(candidateName)}</span>
        <div class="score-bar-track">
          <div class="score-bar">
            <div class="score-bar-fill" style="--bar-width: ${clamp100(dirAB)}%; width: ${clamp100(dirAB)}%"></div>
          </div>
        </div>
        <span class="score-bar-value">${fmt(dirAB)}</span>
      </div>
      <div class="score-bar-row">
        <span class="score-bar-label">${esc(candidateName)} → ${esc(targetName)}</span>
        <div class="score-bar-track">
          <div class="score-bar">
            <div class="score-bar-fill" style="--bar-width: ${clamp100(dirBA)}%; width: ${clamp100(dirBA)}%"></div>
          </div>
        </div>
        <span class="score-bar-value">${fmt(dirBA)}</span>
      </div>
    </div>`;
}

// --------------- Render: Confidence Meter ---------------

function renderConfidenceMeter(confidence) {
  if (!confidence) return '';

  const pct = typeof confidence.confidence === 'number'
    ? (confidence.confidence * 100)
    : 0;
  const level = pct >= 80 ? 'high' : pct >= 60 ? 'medium' : 'low';

  return `
    <div class="confidence-meter" aria-label="Monte Carlo confidence">
      <div class="confidence-header">
        <span class="confidence-value ${level}">${fmt(pct)}%</span>
        <span class="confidence-label">Monte Carlo Confidence</span>
      </div>
      <div class="confidence-bar">
        <div class="confidence-bar-fill ${level}" style="width: ${clamp100(pct)}%"></div>
      </div>
      <p class="confidence-explanation">
        Top pick was stable across ${fmt(pct)}% of weight perturbations.${confidence.runnerUp
          ? ` Runner-up: ${esc(confidence.runnerUp)} (appeared in ${fmt(confidence.runnerUpFrequency * 100)}% of trials).`
          : ' No close runner-up detected.'}
      </p>
    </div>`;
}

// --------------- Render: Attribution Bars ---------------

function renderAttributionBars(attribution) {
  if (!attribution?.categories || attribution.categories.length === 0) return '';

  const rows = attribution.categories.map(cat => {
    const scoreWidth = clamp100(cat.score);
    const cohortPos = clamp100(cat.cohortAvg);
    const delta = cat.delta != null ? cat.delta : 0;
    const deltaClass = delta >= 0 ? 'positive' : 'negative';
    const deltaStr = delta >= 0 ? `+${fmt(delta)}` : fmt(delta);

    return `
      <div class="attribution-row">
        <span class="attribution-label">${esc(cat.name)}</span>
        <div class="attribution-bar-container">
          <div class="attribution-bar-score" style="--bar-width: ${scoreWidth}%; width: ${scoreWidth}%"></div>
          <div class="attribution-bar-cohort" style="left: ${cohortPos}%"></div>
        </div>
        <span class="attribution-delta ${deltaClass}">${deltaStr}</span>
      </div>`;
  }).join('');

  return `
    <div class="attribution-bars" aria-label="Category attribution">
      ${rows}
    </div>`;
}

// --------------- Render: Dealbreaker Flags ---------------

function renderDealbreakers(flags) {
  if (!flags || flags.length === 0) return '';
  const pills = flags.map(f =>
    `<span class="dealbreaker-flag">⚠ ${esc(f)}</span>`
  ).join('');
  return `<div class="dealbreaker-flags">${pills}</div>`;
}

// --------------- Render: Loading Spinner ---------------

function renderLoading(message) {
  return `
    <div class="loading-spinner" aria-label="Loading">
      <div class="loading-dots">
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
      </div>
      <div class="loading-text">${esc(message)}</div>
    </div>`;
}

// --------------- Render: Verdict ---------------

function renderVerdict(state) {
  const { verdict, verdictLoading } = state;
  const activeKey = state.activeProvider === 'claude' ? state.claudeApiKey : state.geminiApiKey;
  const providerName = state.activeProvider === 'claude' ? 'Claude' : 'Gemini';

  let content = '';

  if (verdictLoading) {
    content = renderLoading(`Romeo is composing his verdict via ${providerName}…`);
  } else if (verdict?.error) {
    content = `<p class="error-message">${esc(verdict.message)}</p>`;
  } else if (verdict) {
    content = `
      <div class="verdict-card">
        <div class="verdict-headline">${esc(verdict.headline)}</div>
        <p class="verdict-text">${esc(verdict.verdict)}</p>
        ${verdict.conversation_starter ? `
          <div class="conversation-starter">
            <div class="conversation-starter-label">Suggested Opening Line</div>
            ${esc(verdict.conversation_starter)}
          </div>` : ''}
      </div>`;
  } else if (!activeKey) {
    content = `<p class="api-key-prompt">Enter a ${esc(providerName)} API key above to unlock AI-powered match analysis</p>`;
  }

  return `
    <div class="match-card-section">
      <div class="section-title">Romeo's Verdict</div>
      ${content}
    </div>`;
}

// --------------- Render: Chemistry Panel ---------------

function renderChemistry(state, targetId, candidateId) {
  const { chemistry, chemistryLoading } = state;
  const activeKey = state.activeProvider === 'claude' ? state.claudeApiKey : state.geminiApiKey;
  const providerName = state.activeProvider === 'claude' ? 'Claude' : 'Gemini';

  let buttonHtml = '';
  if (!chemistry && !chemistryLoading) {
    const disabled = !activeKey ? 'disabled' : '';
    buttonHtml = `
      <button
        id="chemistry-btn"
        class="chemistry-btn"
        ${disabled}
        onclick="window.Romeo.fetchChemistry('${esc(targetId)}', '${esc(candidateId)}')"
      >🧪 Simulate First Date Conversation</button>`;
    if (!activeKey) {
      buttonHtml += `<p class="api-key-prompt" style="margin-top:6px">Requires ${esc(providerName)} API key</p>`;
    }
  }

  let panelHtml = '';
  if (chemistryLoading) {
    panelHtml = renderLoading('Simulating first date conversation…');
  } else if (chemistry?.error) {
    panelHtml = `<p class="error-message">${esc(chemistry.message)}</p>`;
  } else if (chemistry?.dialogue) {
    const speakerA = chemistry.dialogue[0]?.speaker || 'A';

    const bubbles = chemistry.dialogue.map((msg, i) => {
      const side = msg.speaker === speakerA ? 'left' : 'right';
      const tagEmoji = msg.tag === 'spark' ? '🔥' : msg.tag === 'friction' ? '⚡' : '●';
      const tagClass = msg.tag || 'neutral';

      return `
        <div class="chat-bubble ${side}" style="animation-delay: ${i * 0.3}s">
          <div class="chat-speaker">${esc(msg.speaker)}</div>
          <div>${esc(msg.line)}</div>
          <span class="chat-tag ${tagClass}">${tagEmoji} ${esc(msg.tag)}</span>
        </div>`;
    }).join('');

    panelHtml = `
      <div class="chemistry-panel">
        <div class="chemistry-title">Chemistry Simulation</div>
        <div class="chat-transcript">${bubbles}</div>
        <div class="chemistry-summary">
          <p class="verdict-text">${esc(chemistry.summary)}</p>
          <div class="spark-score-display">
            <span class="spark-score-value">${fmt(chemistry.sparkScore)}</span>
            <span class="spark-score-label">/ 10 Spark Score</span>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="match-card-section">
      <div class="section-title">Chemistry Simulator</div>
      ${buttonHtml}
      ${panelHtml}
    </div>`;
}

// --------------- Render: Top Match Card (#1) ---------------

function renderTopMatchCard(ranking, state) {
  if (!ranking || ranking.length === 0) return '<p class="error-message">No matches found.</p>';

  const top = ranking[0];
  const targetId = state.selectedProfileId;
  const stablePartnerId = state.results?.stableMatching?.get(targetId);
  const isMutuallyOptimal = stablePartnerId === top.candidateId;
  const candidate = state.profiles.find(p => p.id === top.candidateId);
  const target = state.profiles.find(p => p.id === targetId);

  if (!candidate) return '';

  // Determine card classes
  const cardClasses = ['match-card', 'top-pick'];
  if (isMutuallyOptimal) cardClasses.push('mutually-optimal');

  // Badge
  const badge = isMutuallyOptimal
    ? `<div class="wax-seal"><span class="wax-seal-text">Stable<br>Match</span></div>`
    : `<span class="top-pick-badge">Top Pick ✦</span>`;

  // Stable match note (when top pick ≠ stable match)
  let stableNote = '';
  if (!isMutuallyOptimal && stablePartnerId) {
    const stablePartner = state.profiles.find(p => p.id === stablePartnerId);
    const stablePartnerName = stablePartner?.name || stablePartnerId;
    stableNote = `
      <div class="match-card-section">
        <div class="stable-match-note">
          Your Gale-Shapley stable partner is <strong>${esc(stablePartnerName)}</strong>.
          In globally stable matching, individuals may rank slightly below their personal top pick 
          to ensure no pair would mutually prefer to switch.
        </div>
      </div>`;
  }

  // Flags
  let flagsHtml = '';
  try {
    // Check if we have flags in the ranking or can get them
    const flags = [];
    if (flags.length > 0) {
      flagsHtml = `<div class="match-card-section">${renderDealbreakers(flags)}</div>`;
    }
  } catch (_) { /* ignore */ }

  return `
    <article class="${cardClasses.join(' ')}" id="match-card-${esc(top.candidateId)}" aria-label="Top match: ${esc(candidate.name)}">
      ${isMutuallyOptimal ? badge : ''}
      <div class="match-card-header">
        <div class="rank-number">#1</div>
        <div>
          <div class="match-card-name">${esc(candidate.name)}</div>
          <div class="match-card-meta">${esc(candidate.age)} · ${esc(candidate.city)} · ${esc(candidate.occupation)}</div>
        </div>
        <div class="match-card-badges">
          ${!isMutuallyOptimal ? badge : ''}
        </div>
      </div>

      <div class="match-card-body">
        <!-- Scores Section -->
        <div class="match-card-section">
          <div class="section-title">Compatibility Scores</div>
          <div class="score-display">
            <div>
              <div class="reciprocal-score">${fmt(top.reciprocalScore)}</div>
              <div class="reciprocal-label">Reciprocal Score (Harmonic Mean)</div>
            </div>
            <div class="directional-scores">
              <div class="directional-item">
                <div class="directional-value">${fmt(top.directionalAB)}</div>
                <div class="directional-label">${esc(target?.name || 'You')} → ${esc(candidate.name)}</div>
              </div>
              <div class="directional-item">
                <div class="directional-value">${fmt(top.directionalBA)}</div>
                <div class="directional-label">${esc(candidate.name)} → ${esc(target?.name || 'You')}</div>
              </div>
            </div>
          </div>
          ${renderScoreBars(top.reciprocalScore, top.directionalAB, top.directionalBA, target?.name || 'You', candidate.name)}
        </div>

        ${stableNote}

        <!-- Confidence Section -->
        <div class="match-card-section">
          <div class="section-title">Confidence Analysis</div>
          ${renderConfidenceMeter(state.confidence)}
        </div>

        <!-- Attribution Section -->
        <div class="match-card-section">
          <div class="section-title">Category Attribution</div>
          ${renderAttributionBars(state.attribution)}
        </div>

        ${flagsHtml}

        <!-- Verdict Section -->
        ${renderVerdict(state)}

        <!-- Chemistry Section -->
        ${renderChemistry(state, targetId, top.candidateId)}
      </div>
    </article>`;
}

// --------------- Render: Compact Candidate Card ---------------

function renderCompactCard(entry, rank, state) {
  const targetId = state.selectedProfileId;
  const stablePartnerId = state.results?.stableMatching?.get(targetId);
  const isStablePartner = stablePartnerId === entry.candidateId;
  const isExpanded = state.expandedCardId === entry.candidateId;
  const candidate = state.profiles.find(p => p.id === entry.candidateId);
  const target = state.profiles.find(p => p.id === targetId);

  if (!candidate) return '';

  const cardClasses = ['match-card', 'compact'];
  if (isStablePartner) cardClasses.push('mutually-optimal');

  let expandedContent = '';
  if (isExpanded) {
    expandedContent = `
      <div class="match-card-body">
        <div class="match-card-section">
          <div class="section-title">Compatibility Scores</div>
          <div class="score-display">
            <div>
              <div class="reciprocal-score" style="font-size:1.8rem">${fmt(entry.reciprocalScore)}</div>
              <div class="reciprocal-label">Reciprocal Score</div>
            </div>
            <div class="directional-scores">
              <div class="directional-item">
                <div class="directional-value">${fmt(entry.directionalAB)}</div>
                <div class="directional-label">${esc(target?.name || 'You')} → ${esc(candidate.name)}</div>
              </div>
              <div class="directional-item">
                <div class="directional-value">${fmt(entry.directionalBA)}</div>
                <div class="directional-label">${esc(candidate.name)} → ${esc(target?.name || 'You')}</div>
              </div>
            </div>
          </div>
          ${renderScoreBars(entry.reciprocalScore, entry.directionalAB, entry.directionalBA, target?.name || 'You', candidate.name)}
        </div>

        ${state.attribution && state.expandedCardId === entry.candidateId ? `
        <div class="match-card-section">
          <div class="section-title">Category Attribution</div>
          ${renderAttributionBars(state.attribution)}
        </div>` : ''}
      </div>`;
  }

  return `
    <article
      class="${cardClasses.join(' ')}"
      id="match-card-${esc(entry.candidateId)}"
      aria-label="Match #${rank}: ${esc(candidate.name)}"
    >
      <div class="compact-header" onclick="window.Romeo.expandCard('${esc(entry.candidateId)}')">
        <div class="rank-number">#${rank}</div>
        <div>
          <div class="match-card-name" style="font-size:1.1rem">${esc(candidate.name)}</div>
          <div class="match-card-meta">${esc(candidate.age)} · ${esc(candidate.city)} · ${esc(candidate.occupation)}</div>
        </div>
        ${isStablePartner ? '<span class="stable-indicator">⊛ Stable Match</span>' : ''}
        <div style="margin-left:auto; display:flex; align-items:center; gap:12px">
          <div style="text-align:right">
            <div class="compact-score">${fmt(entry.reciprocalScore)}</div>
            <div class="compact-directional">${fmt(entry.directionalAB)} / ${fmt(entry.directionalBA)}</div>
          </div>
          <button class="expand-btn" aria-label="${isExpanded ? 'Collapse' : 'Expand'} details">
            <span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▾</span>
          </button>
        </div>
      </div>
      ${expandedContent}
    </article>`;
}

// --------------- Render: Results ---------------

function renderResults(state) {
  if (!state.results || !state.selectedProfileId) return '';

  const targetId = state.selectedProfileId;
  const target = state.profiles.find(p => p.id === targetId);
  const ranking = state.results.rankings.get(targetId);

  if (!ranking || ranking.length === 0) {
    return `<p class="error-message">No compatible candidates found for this profile.</p>`;
  }

  const topCard = renderTopMatchCard(ranking, state);
  const remainingCards = ranking.slice(1).map((entry, i) =>
    renderCompactCard(entry, i + 2, state)
  ).join('');

  return `
    <section class="results-panel" aria-label="Match results">
      ${renderTargetBrief(target)}
      ${topCard}
      ${remainingCards}
    </section>`;
}

// --------------- Render: Stable Matching Graph ---------------

function renderStableGraph(state) {
  if (!state.showGraph || !state.results) return '';

  return `
    <div class="stable-graph-container" id="stable-graph-overlay" role="dialog" aria-label="Stable matching graph">
      <div class="graph-header">
        <div class="graph-title">Gale-Shapley Stable Matching</div>
        <button class="graph-close-btn" id="graph-close-btn" onclick="window.Romeo.toggleGraph()" aria-label="Close graph">×</button>
      </div>
      <canvas class="graph-canvas" id="stable-graph-canvas"></canvas>
    </div>`;
}

/** Draw the stable matching graph on the canvas */
function drawStableGraph(state) {
  const canvas = document.getElementById('stable-graph-canvas');
  if (!canvas || !state.results) return;

  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  // Set canvas resolution
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = (rect.height - 60) * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = (rect.height - 60) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height - 60;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Separate profiles by gender
  const profiles = state.profiles || [];
  const males = profiles.filter(p => p.gender?.toLowerCase() === 'male' || p.gender?.toLowerCase() === 'm');
  const females = profiles.filter(p => p.gender?.toLowerCase() === 'female' || p.gender?.toLowerCase() === 'f');

  // If no clear gender split, use first half / second half
  let leftGroup, rightGroup;
  if (males.length > 0 && females.length > 0) {
    leftGroup = males;
    rightGroup = females;
  } else {
    const half = Math.ceil(profiles.length / 2);
    leftGroup = profiles.slice(0, half);
    rightGroup = profiles.slice(half);
  }

  const leftX = W * 0.22;
  const rightX = W * 0.78;
  const nodeRadius = Math.min(22, H / (Math.max(leftGroup.length, rightGroup.length) * 3));
  const stableMatching = state.results.stableMatching;
  const selectedId = state.selectedProfileId;
  const stablePartner = selectedId ? stableMatching.get(selectedId) : null;

  // Column labels
  ctx.font = `600 13px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(males.length > 0 ? 'Male' : 'Group A', leftX, 28);
  ctx.fillText(females.length > 0 ? 'Female' : 'Group B', rightX, 28);

  // Compute node positions
  const nodePositions = new Map();
  const topPad = 50;
  const bottomPad = 30;
  const availH = H - topPad - bottomPad;

  leftGroup.forEach((p, i) => {
    const y = topPad + (availH / (leftGroup.length + 1)) * (i + 1);
    nodePositions.set(p.id, { x: leftX, y, side: 'left' });
  });

  rightGroup.forEach((p, i) => {
    const y = topPad + (availH / (rightGroup.length + 1)) * (i + 1);
    nodePositions.set(p.id, { x: rightX, y, side: 'right' });
  });

  // Draw connection lines
  const drawnPairs = new Set();
  stableMatching.forEach((partnerId, personId) => {
    const pairKey = [personId, partnerId].sort().join('-');
    if (drawnPairs.has(pairKey)) return;
    drawnPairs.add(pairKey);

    const posA = nodePositions.get(personId);
    const posB = nodePositions.get(partnerId);
    if (!posA || !posB) return;

    const isHighlight = personId === selectedId || partnerId === selectedId;

    ctx.beginPath();
    ctx.moveTo(posA.x, posA.y);
    // Bezier curve for elegant connections
    const cpX = (posA.x + posB.x) / 2;
    const cpOffset = (posA.y - posB.y) * 0.15;
    ctx.bezierCurveTo(cpX - cpOffset, posA.y, cpX + cpOffset, posB.y, posB.x, posB.y);

    if (isHighlight) {
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(201, 168, 76, 0.4)';
      ctx.shadowBlur = 12;
    } else {
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.25)';
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  // Draw nodes — render circles, then initials inside, then name labels to the side.
  // Previous approach placed labels below circles, but with 10 nodes and ~38px spacing,
  // the label at (y + radius + 16) consistently overlapped with the next circle.
  // New approach: draw names to the LEFT of left-column nodes and RIGHT of right-column nodes.

  // Pass 1: Draw all node circles
  profiles.forEach(p => {
    const pos = nodePositions.get(p.id);
    if (!pos) return;

    const isSelected = p.id === selectedId;
    const isPartner = p.id === stablePartner;
    const isHighlight = isSelected || isPartner;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);

    if (isHighlight) {
      ctx.fillStyle = '#1a2332';
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(201, 168, 76, 0.3)';
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = '#1a2332';
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
    }

    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  // Pass 2: Draw all node labels — positioned to the SIDE of each node
  // Left-column nodes: label to the left of the circle
  // Right-column nodes: label to the right of the circle
  // This completely avoids any vertical overlap between labels and circles.
  profiles.forEach(p => {
    const pos = nodePositions.get(p.id);
    if (!pos) return;

    const isSelected = p.id === selectedId;
    const isPartner = p.id === stablePartner;
    const isHighlight = isSelected || isPartner;

    const firstName = (p.name || p.id).split(' ')[0];
    const fontSize = Math.max(9, Math.min(11, nodeRadius * 0.7));
    ctx.font = `${isHighlight ? '600' : '400'} ${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = isHighlight ? '#d4af37' : '#e8e2d8';

    if (pos.side === 'left') {
      // Label to the left of the node
      ctx.textAlign = 'right';
      ctx.fillText(firstName, pos.x - nodeRadius - 8, pos.y + 4);
    } else {
      // Label to the right of the node
      ctx.textAlign = 'left';
      ctx.fillText(firstName, pos.x + nodeRadius + 8, pos.y + 4);
    }
  });
}

// --------------- Render: Toggle Graph Button ---------------

function renderToggleButton(state) {
  if (!state.results) return '';
  return `
    <button
      class="toggle-graph-btn"
      id="toggle-graph-btn"
      onclick="window.Romeo.toggleGraph()"
      aria-label="Toggle stable matching graph"
    >◉ Stable Pairs</button>`;
}

// --------------- Render: Toast Notification ---------------

function renderToast(state) {
  if (!state.toast) return '';

  const typeClass = state.toast.type || 'error';
  return `
    <div class="toast-notification ${typeClass}" role="alert" aria-live="assertive">
      <span class="toast-message">${esc(state.toast.message)}</span>
      <button class="toast-dismiss" onclick="window.Romeo.dismissToast()" aria-label="Dismiss">×</button>
    </div>`;
}

// --------------- Master Render ---------------

/**
 * Master render function. Clears #app and re-renders everything.
 * @param {object} state — application state
 */
export function renderApp(state) {
  const app = document.getElementById('app');
  if (!app) return;

  // Preserve input values before clearing (both key fields)
  const currentClaudeKey = document.getElementById('api-key-claude')?.value;
  if (currentClaudeKey !== undefined && currentClaudeKey !== '') {
    state.claudeApiKey = currentClaudeKey;
  }
  const currentGeminiKey = document.getElementById('api-key-gemini')?.value;
  if (currentGeminiKey !== undefined && currentGeminiKey !== '') {
    state.geminiApiKey = currentGeminiKey;
  }

  // Build full HTML
  const html = `
    <div class="app-container">
      ${renderHeader()}
      ${renderControls(state)}
      ${renderToast(state)}
      <main>
        ${state.selectedProfileId
          ? renderResults(state)
          : renderWelcome()}
      </main>
    </div>
    ${renderToggleButton(state)}
    ${renderStableGraph(state)}
  `;

  app.innerHTML = html;

  // Post-render: draw graph if visible
  if (state.showGraph) {
    requestAnimationFrame(() => drawStableGraph(state));

    // Handle resize
    const resizeHandler = () => drawStableGraph(state);
    window.__romeoResizeHandler && window.removeEventListener('resize', window.__romeoResizeHandler);
    window.__romeoResizeHandler = resizeHandler;
    window.addEventListener('resize', resizeHandler);
  }

  // Post-render: restore focus if needed
  if (state.selectedProfileId) {
    const selector = document.getElementById('profile-selector');
    if (selector && selector.value !== state.selectedProfileId) {
      selector.value = state.selectedProfileId;
    }
  }
}
