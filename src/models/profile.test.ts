import assert from 'node:assert/strict'
import test from 'node:test'
import { FKNATSSHProfile, parseFKNATQuickConnect, toNativeSSHProfile } from './profile'

const address = 'a1'.repeat(32)

test('quick connect accepts the dedicated scheme only', () => {
    const profile = parseFKNATQuickConnect(`fknat://alice@${address}`)
    assert.equal(profile?.type, 'fknat-ssh')
    assert.equal(profile?.options?.user, 'alice')
    assert.equal(parseFKNATQuickConnect(`alice@${address}`), null)
    assert.equal(parseFKNATQuickConnect('fknat://not-an-address'), null)
    assert.equal(parseFKNATQuickConnect(`fknat://bad%ZZ@${address}`), null)
})

test('converts FKNAT metadata to a native SSH profile', () => {
    const profile = {
        id: 'fknat-ssh:test', type: 'fknat-ssh', name: 'test', options: {
            address, user: 'root', port: 2222, auth: 'agent', agentForward: true,
        },
    } as FKNATSSHProfile
    const native = toNativeSSHProfile(profile, "'/helper' connect --server-id 'target'")
    assert.equal(native.type, 'ssh')
    assert.equal(native.options.host, address)
    assert.equal(native.options.port, 2222)
    assert.equal(native.options.proxyCommand, "'/helper' connect --server-id 'target'")
    assert.equal(native.options.agentForward, true)
    assert.equal(native.options.keepaliveInterval, 5000)
    assert.equal(native.options.keepaliveCountMax, 10)
    assert.equal(native.options.reuseSession, true)
    assert.deepEqual(Object.keys(native.options.algorithms ?? {}).sort(), [
        'cipher', 'compression', 'hmac', 'kex', 'serverHostKey',
    ])
    for (const algorithms of Object.values(native.options.algorithms ?? {})) {
        assert.ok(algorithms.length > 0)
    }
})
