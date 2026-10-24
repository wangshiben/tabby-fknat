import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHelperError } from './errors'

test('maps a structured helper error without exposing raw stderr', () => {
    assert.deepEqual(parseHelperError('log\nFKNAT_ERROR code=SERVER_OFFLINE message="offline"\n'), {
        code: 'SERVER_OFFLINE',
        message: 'The FKNAT target is currently offline.',
    })
    assert.equal(parseHelperError('ordinary SSH error'), null)
})

test('maps route availability failures separately from an offline target', () => {
    assert.deepEqual(parseHelperError('stage=dial_route\nFKNAT_ERROR code=ROUTE_UNAVAILABLE message="timeout"\n'), {
        code: 'ROUTE_UNAVAILABLE',
        message: 'The FKNAT target is reachable, but its SSH route is not available.',
    })
})
