// Type definitions for @harpd/agent-budget-policy

export const POLICY_VERSION: string

/** Per-call cap. Defaults: `usdMax = 0.05`. */
export interface PerCallCap {
  /** Maximum USD allowed per single payment. Defaults to 0.05. */
  usdMax: number
  /** Optional override flag — set true to bypass the per-call ceiling.
   * Use sparingly; auditing this field is what makes the per-call cap real. */
  override?: boolean | null
}

/** A single scope cap (per-agent, per-endpoint, per-tool). */
export interface ScopeCap {
  /** USD budget for this scope's window. */
  usd: number
  /** Time window: '1h' | '6h' | '12h' | '1d' | '7d' | '30d'. Default '1d'. */
  window?: string
}

/** Map of scope-id → cap. The special key '*' matches any id not listed. */
export type ScopeMap = Record<string, ScopeCap>

/** Declarative budget spec passed to defineBudget(). */
export interface BudgetSpec {
  perCall?: PerCallCap
  perAgent?: ScopeMap
  perEndpoint?: ScopeMap
  perTool?: ScopeMap
  /** Optional CAIP-19 token allowlist (e.g. 'eip155:8453/erc20:0xUSDC').
   * null/undefined = accept any token. */
  allowedTokens?: string[] | null
}

/** Frozen, normalized Policy produced by defineBudget(). */
export interface Policy {
  version: string
  perCall: PerCallCap
  perAgent: ScopeMap
  perEndpoint: ScopeMap
  perTool: ScopeMap
  allowedTokens: string[] | null
  createdAt: string
}

/** A payment intent. Local-only fields the evaluator needs. */
export interface PaymentIntent {
  agentId: string
  endpoint: string
  /** Either amountUsd (dollars) or amount (micro-USDC) — evaluate accepts either. */
  amountUsd?: number
  amount?: number
  /** Optional tool id — only needed if the policy has perTool caps. */
  toolId?: string
  /** Optional CAIP-19 token id, checked against allowedTokens. */
  asset?: string
}

/** A resolved scope cap row returned in a Decision. */
export interface ScopeDetermination {
  scope: 'perAgent' | 'perEndpoint' | 'perTool'
  id: string
  usd: number
  window: string
}

/** The decision returned by evaluate(). */
export interface Decision {
  allowed: boolean
  reason: string | null
  /** Present only for windowed denials — ISO datetime when retry becomes safe. */
  retryAfter?: string | null
  /** Present on perCall denials. */
  limit?: number
  proposed?: number
  /** Allowed responses carry the resolved scope caps, so the caller can show
   * "this endpoint is capped at $1/day" without another round-trip. */
  scopes?: ScopeDetermination[]
}

/** Validation result from validatePolicyRules(). */
export type Validation =
  | { ok: true }
  | { ok: false; error: string }

export function defineBudget(spec?: BudgetSpec): Policy
export function evaluate(policy: Policy, intent: PaymentIntent): Decision
export function validatePolicyRules(spec: BudgetSpec): Validation

export const __internal: {
  windowMs: (w: string) => number
  resolveScopes: (p: Policy, i: PaymentIntent) => ScopeDetermination[]
  ALLOWED_WINDOWS: Record<string, number>
}
