// @harpd/agent-budget-policy — local, synchronous budget control for agent payments.
//
// Declare per-call, per-agent, per-endpoint, per-tool caps in plain JS and
// evaluate them locally before a payment is sent. Zero runtime dependencies.
// Works alongside @harpd/observe (which forwards events to the collector);
// this module makes the *decision*, observe does the *recording*.
//
// Why local + synchronous: a payment denial must not block on the network.
// The fastest, most reliable deny is the one that never makes a network call.

export const POLICY_VERSION = '0.1.0'

const MS_PER_DAY = 86_400_000
const MS_PER_HOUR = 3_600_000

const ALLOWED_WINDOWS = {
  '1h': MS_PER_HOUR,
  '6h': 6 * MS_PER_HOUR,
  '12h': 12 * MS_PER_HOUR,
  '1d': MS_PER_DAY,
  '7d': 7 * MS_PER_DAY,
  '30d': 30 * MS_PER_DAY,
}

function windowMs(window) {
  const ms = ALLOWED_WINDOWS[window]
  if (ms == null) throw new Error("unknown window '" + window + "'. Must be one of: " + Object.keys(ALLOWED_WINDOWS).join(', '))
  return ms
}

// Sane defaults — set against the bugs we've actually seen.
// See https://harpd.com/blog/agent-payment-risk-cases
const DEFAULT_PER_CALL_USD_MAX = 0.05

/**
 * Build a Policy from a declarative spec.
 *
 * @example
 * const p = defineBudget({
 *   perCall:  { usdMax: 0.05 },
 *   perAgent: { 'weather-agent': { usd: 1, window: '1d' } },
 *   perEndpoint: { '*': { usd: 1, window: '1d' } },
 *   allowedTokens: ['eip155:8453/erc20:0xUSDC'],
 * })
 *
 * @param {BudgetSpec} spec
 * @returns {Policy}
 */
export function defineBudget(spec = {}) {
  const perCall = {
    usdMax: spec.perCall?.usdMax ?? DEFAULT_PER_CALL_USD_MAX,
    override: spec.perCall?.override ?? null,
    ...spec.perCall,
  }

  // Normalize each scope map. A '*' key matches any id; '*' is filled in to
  // allow the evaluator to fall through to a default cap when no specific
  // agent/endpoint/tool cap is matched.
  const normalize = (map) => {
    const out = {}
    if (!map) return out
    for (const [k, v] of Object.entries(map)) {
      out[k] = { usd: Number(v.usd), window: v.window ?? '1d', windowMs: windowMs(v.window ?? '1d') }
    }
    if (!out['*']) out['*'] = null  // null = no default cap at this scope
    return out
  }

  const policy = {
    version: POLICY_VERSION,
    perCall,
    perAgent: normalize(spec.perAgent),
    perEndpoint: normalize(spec.perEndpoint),
    perTool: normalize(spec.perTool),
    allowedTokens: spec.allowedTokens ?? null,
    createdAt: new Date().toISOString(),
  }

  // Freeze so callers can't mutate by accident — policies should be rebuilt,
  // not edited in place (the policy version + createdAt are audit signals).
  return Object.freeze(policy)
}

/**
 * Evaluate an intent against a policy. Pure + synchronous. Does NOT track
 * spend across calls — the spend ledger lives in @harpd/observe's queue +
 * the collector. This function only checks the *shape* of the intent
 * against the caps, plus the per-call max which is the only thing knowable
 * without history.
 *
 * For run-state checks (have we already spent $0.50 against this endpoint
 * today?), wire in the observe plugin's `budgetControl: true` mode — that
 * asks the collector, which holds the cumulative ledger.
 *
 * @param {Policy} policy
 * @param {PaymentIntent} intent
 * @returns {Decision}
 */
export function evaluate(policy, intent) {
  if (!policy || typeof policy !== 'object') {
    return deny('no_policy_loaded')
  }
  if (!intent || typeof intent !== 'object') {
    return deny('invalid_intent')
  }

  const amountUsd = Number(intent.amountUsd ?? intent.amount)
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    return deny('invalid_amount')
  }

  // 1. Per-call cap. This is the synchronously-checkable ceiling that catches
  //    the wrong-decimals overcharge bug regardless of history.
  if (amountUsd > policy.perCall.usdMax) {
    return deny('perCall', {
      limit: policy.perCall.usdMax,
      proposed: amountUsd,
      retryAfter: null,  // perCall denials aren't retryable
    })
  }

  // 2. Token allowlist. Optional — null = accept any token.
  if (policy.allowedTokens && intent.asset) {
    if (!policy.allowedTokens.includes(intent.asset)) {
      return deny('token_not_allowed', { token: intent.asset, allowed: policy.allowedTokens })
    }
  }

  // 3. Scope caps — we don't have the cumulative ledger locally, so these
  //    produce a *determination* object, not a hard deny. Callers (or the
  //    observe plugin in budgetControl mode) follow up with the collector
  //    to confirm the cumulative check.
  const scopes = resolveScopes(policy, intent)
  return allow({ scopes })
}

/**
 * Map the intent to its applicable cap rows. Returns the resolved rows
 * (most-specific wins) so the caller can show the user "your cap for this
 * endpoint is $1/day" without round-tripping.
 *
 * @param {Policy} policy
 * @param {PaymentIntent} intent
 * @returns {ScopeDetermination[]}
 */
function resolveScopes(policy, intent) {
  const out = []

  const pick = (map, id, scope) => {
    if (!map) return null
    return map[id] ?? map['*'] ?? null
  }

  const agent = pick(policy.perAgent, intent.agentId, 'perAgent')
  if (agent) out.push({ scope: 'perAgent', id: intent.agentId, usd: agent.usd, window: agent.window })
  const endpoint = pick(policy.perEndpoint, intent.endpoint, 'perEndpoint')
  if (endpoint) out.push({ scope: 'perEndpoint', id: intent.endpoint, usd: endpoint.usd, window: endpoint.window })
  const tool = pick(policy.perTool, intent.toolId, 'perTool')
  if (tool) out.push({ scope: 'perTool', id: intent.toolId, usd: tool.usd, window: tool.window })

  return out
}

function allow(extras = {}) {
  return Object.assign({ allowed: true, reason: null }, extras)
}

function deny(reason, extras = {}) {
  // The retryAfter field is missing for non-retryable denials (perCall,
  // token_not_allowed, invalid_intent). For windowed denials, the observe
  // plugin fills it in from the collector's ledger. Local-only callers
  // should treat a missing retryAfter as "don't retry."
  return Object.assign({ allowed: false, reason, retryAfter: null }, extras)
}

/**
 * Validate that a Policy spec is well-formed before loading it.
 * Use this at app boot — fail fast on a bad policy instead of mid-payment.
 *
 * @param {BudgetSpec} spec
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePolicyRules(spec) {
  try {
    if (typeof spec !== 'object' || spec === null) return { ok: false, error: 'spec must be an object' }
    if (spec.perCall && typeof spec.perCall !== 'object') return { ok: false, error: 'perCall must be an object' }
    if (spec.perCall?.usdMax != null && (typeof spec.perCall.usdMax !== 'number' || spec.perCall.usdMax < 0)) return { ok: false, error: 'perCall.usdMax must be a non-negative number' }
    for (const scope of ['perAgent', 'perEndpoint', 'perTool']) {
      const map = spec[scope]
      if (map != null) {
        if (typeof map !== 'object') return { ok: false, error: scope + ' must be an object map' }
        for (const [k, v] of Object.entries(map)) {
          if (typeof v !== 'object' || v == null) return { ok: false, error: scope + "['" + k + "'] must be an object" }
          if (typeof v.usd !== 'number' || v.usd < 0) return { ok: false, error: scope + "['" + k + "'].usd must be a non-negative number" }
          if (v.window != null && !ALLOWED_WINDOWS[v.window]) return { ok: false, error: scope + "['" + k + "'].window '" + v.window + "' unknown" }
        }
      }
    }
    if (spec.allowedTokens != null && !Array.isArray(spec.allowedTokens)) return { ok: false, error: 'allowedTokens must be an array' }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) }
  }
}

export const __internal = { windowMs, resolveScopes, ALLOWED_WINDOWS }
