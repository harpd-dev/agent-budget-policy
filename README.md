# @harpd/agent-budget-policy

Local, synchronous budget control for agent payments. Declare per-call,
per-agent, per-endpoint, per-tool caps in plain JavaScript and evaluate them
**before** a payment is sent. Zero runtime dependencies — works in Node,
browsers, edge runtimes, anywhere ESM runs.

> **The open-source half of Harpd's budget story.** This module makes the
> *decision*; `@harpd/observe` does the *recording*; the Harpd hosted
> collector does the *cumulative ledger + cross-team policy*.

## Why local + synchronous

A payment denial must not block on the network. The fastest, most reliable
deny is the one that never makes a network call. This SDK evaluates intents
against the policy caps **synchronously**, with no async, no fetch, no DB
hit. The per-call cap (the one that catches the
[wrong-decimals overcharge bug](https://harpd.com/blog/agent-payment-risk-cases))
is fully enforceable from the local policy alone.

Cumulative caps (have we already spent $0.50 against this endpoint today?)
need history — that lives in `@harpd/observe`'s queue + the Harpd
collector. Wire `budgetControl: true` into `harpdPlugin()` and the collector
fills in the cumulative check.

## Install

```bash
npm install @harpd/agent-budget-policy
# or
pnpm add @harpd/agent-budget-policy
```

## Usage

```ts
import { defineBudget, evaluate, validatePolicyRules } from '@harpd/agent-budget-policy'

const spec = {
  perCall:  { usdMax: 0.05 },
  perAgent: { 'weather-agent': { usd: 1, window: '1d' } },
  perEndpoint: { '*': { usd: 1, window: '1d' } },
  allowedTokens: ['eip155:8453/erc20:0xUSDC'],
}

// Fail fast on a badly-shaped policy. Use at app boot, not mid-payment.
const validation = validatePolicyRules(spec)
if (!validation.ok) throw new Error('bad policy: ' + validation.error)

const policy = defineBudget(spec)

// Synchronous — never blocks on the network.
const ok = evaluate(policy, {
  agentId: 'weather-agent',
  endpoint: 'https://paid-weather.example.com/v1',
  amountUsd: 0.01,
})

if (!ok.allowed) {
  console.log('deny:', ok.reason)   // 'perCall' | 'token_not_allowed' | 'invalid_intent' | 'no_policy_loaded'
} else {
  // ok.scopes === the resolved cap rows for this intent —
  // show them to the user so they know what's enforceable here.
  console.log('allowed; caps:', ok.scopes)
}
```

## API

### `defineBudget(spec?): Policy`

Build a frozen, normalized `Policy` from a declarative spec. Optional — if
you skip every field, you get a policy with the sane defaults
(`perCall.usdMax = 0.05`, no token allowlist, no scope caps).

### `evaluate(policy, intent): Decision`

Pure + synchronous. Returns:

```ts
interface Decision {
  allowed: boolean
  reason: string | null
  retryAfter?: string | null
  limit?: number       // present on perCall denials
  proposed?: number    // present on perCall denials
  scopes?: ScopeDetermination[]  // present on allows
}
```

### `validatePolicyRules(spec): { ok: true } | { ok: false, error: string }`

Cheap structural validation. Run at app boot so a typo in your policy
config fails the deploy, not the first payment.

## Defaults

These are baked in because we've seen the consequences of not having them
(see the [risk cases post](https://harpd.com/blog/agent-payment-risk-cases)):

| Setting | Default | Why |
|---|---|---|
| `perCall.usdMax` | **`$0.05`** | The wrong-decimals overcharge is the most common bug. A 5-cent ceiling catches it. |
| Window sizes | `'1d'` matches CFO mental model |
| Token allowlist | `null` (any token) | Set it once you ship to prod — restricting to USDC on Base is the sane starting point |

## Tier template

Use these as starting points — copied from the
[budget policy template post](https://harpd.com/blog/agent-budget-policy-template):

```ts
const TIERS = {
  sandbox:     { perCall: 0.01, perAgent: 1,   perEndpoint: 0.50, perTool: 0.10 },
  staging:     { perCall: 0.05, perAgent: 10,  perEndpoint: 2.00,  perTool: 0.50 },
  production:  { perCall: 0.20, perAgent: 100,  perEndpoint: 20,    perTool: 5 },
}
```

## How this composes with @harpd/observe

This SDK is the **local half**. To get cumulative caps + audit + alerts:

```ts
import { harpdPlugin } from '@harpd/observe'
import { defineBudget, evaluate } from '@harpd/agent-budget-policy'

const policy = defineBudget({ perCall: { usdMax: 0.05 }, perEndpoint: { '*': { usd: 1, window: '1d' } } })

const observe = harpdPlugin({
  apiKey: process.env.HARPD_KEY!,
  endpoint: 'https://api.harpd.com',
  budgetControl: true,  // ← now the collector also enforces the cumulative cap
})
```

Without Harpd, the SDK works in observe-only mode — every call still gets a
local decision, you just don't get the dashboard, cross-team policies, or
the email alerts.

## License

MIT © Harpd. Issues and PRs welcome at
[github.com/harpd-dev/agent-budget-policy](https://github.com/harpd-dev/agent-budget-policy).

---

## About Harpd

[Harpd](https://harpd.com) is the AI Cost Intelligence platform for the agent era — measure, optimize and control production AI spend, from **[cost per successful task](https://harpd.com/cost-per-successful-task/)** to agent-payment budgets ([x402](https://github.com/harpd-dev/observe) / USDC).

- Website: <https://harpd.com>
- GitHub org: <https://github.com/harpd-dev>
- Contact: <mailto:harpdsupport@gmail.com>

