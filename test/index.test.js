import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineBudget, evaluate } from '../src/index.js'

const TOKEN = 'eip155:8453/erc20:0x833589fCD6eDb6E30d19fBe0aF730Dc3f6DCfB8f'

test('missing policy fails closed', () => {
  assert.equal(evaluate(null, { agentId: 'a', endpoint: 'https://x', amountUsd: 0.01 }).allowed, false)
  assert.equal(evaluate(undefined, { agentId: 'a', endpoint: 'https://x', amountUsd: 0.01 }).allowed, false)
})

test('defineBudget({}) applies the safe $0.05 default per-call cap', () => {
  const policy = defineBudget({})
  const allowed = evaluate(policy, { agentId: 'a', endpoint: 'https://x', amountUsd: 0.01 })
  assert.equal(allowed.allowed, true)
  const denied = evaluate(policy, { agentId: 'a', endpoint: 'https://x', amountUsd: 0.5 })
  assert.equal(denied.allowed, false)
})

test('per-call cap denies over-cap amounts', () => {
  const policy = defineBudget({ perCall: { usdMax: 0.5 } })
  const denied = evaluate(policy, { agentId: 'a', endpoint: 'https://x', amountUsd: 1.0 })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, 'perCall')
  const okDecision = evaluate(policy, { agentId: 'a', endpoint: 'https://x', amountUsd: 0.5 })
  assert.equal(okDecision.allowed, true)
})

test('token allowlist denial returns allowed=false (regression: was the array)', () => {
  const policy = defineBudget({ allowedTokens: [TOKEN] })
  const denied = evaluate(policy, {
    agentId: 'a', endpoint: 'https://x', amountUsd: 0.01, asset: 'eip155:8453/erc20:0xWRONG',
  })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, 'token_not_allowed')
  assert.deepEqual(denied.allowedTokens, [TOKEN])
})

test('allowed token passes', () => {
  const policy = defineBudget({ perCall: { usdMax: 1 }, allowedTokens: [TOKEN] })
  const okDecision = evaluate(policy, {
    agentId: 'a', endpoint: 'https://x', amountUsd: 0.01, asset: TOKEN,
  })
  assert.equal(okDecision.allowed, true)
})

test('invalid amount is denied', () => {
  const policy = defineBudget({ perCall: { usdMax: 1 } })
  const denied = evaluate(policy, { agentId: 'a', endpoint: 'https://x', amountUsd: -1 })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, 'invalid_amount')
})
