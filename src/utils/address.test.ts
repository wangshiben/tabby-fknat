import assert from 'node:assert/strict'
import test from 'node:test'
import { isFKNATAddress, normalizeFKNATAddress } from './address'

test('normalizes a 64-character hex FKNAT address', () => {
    assert.equal(normalizeFKNATAddress(' AB'.repeat(32).replaceAll(' ', '')), 'ab'.repeat(32))
})

test('rejects malformed FKNAT addresses', () => {
    assert.equal(isFKNATAddress('a'.repeat(63)), false)
    assert.equal(isFKNATAddress('g'.repeat(64)), false)
    assert.throws(() => normalizeFKNATAddress(''))
})
