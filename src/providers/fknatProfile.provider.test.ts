import assert from 'node:assert/strict'
import test from 'node:test'

// Simulate Tabby's registry separately from an npm-installed tabby-ssh copy.
// Importing the latter at runtime must never choose the connection component.
const nodeModule = require('node:module')
const originalLoad = nodeModule._load
class ProfilesServiceToken {}
const core = {
    QuickConnectProfileProvider: class {},
    ProfilesService: ProfilesServiceToken,
    LogService: class {},
}
let FKNATProfileProvider: any
try {
    nodeModule._load = function (request: string, ...args: unknown[]) {
        if (request === 'tabby-core') return core
        if (request === 'tabby-ssh') throw new Error('Loaded a duplicate SSH module')
        return originalLoad.call(this, request, ...args)
    }
    FKNATProfileProvider = require('./fknatProfile.provider').FKNATProfileProvider
} finally {
    nodeModule._load = originalLoad
}

const address = 'ab'.repeat(32)
const proxyCommand = 'helper connect --server-id target'

function createProvider (sshProvider: any) {
    const logs: unknown[] = []
    const logger = Object.fromEntries(['info', 'debug', 'warn', 'error'].map(level => [
        level, (...args: unknown[]) => logs.push(args),
    ]))
    let resolutions = 0
    const injector = {
        get: (token: unknown) => {
            assert.equal(token, ProfilesServiceToken)
            resolutions++
            return {
                providerForProfile: (profile: any) => {
                    assert.equal(profile.type, 'ssh')
                    return sshProvider
                },
                getConfigProxyForProfile: (profile: any) => profile,
            }
        },
    }
    const provider = new FKNATProfileProvider(
        {
            assertExecutable: async () => {},
            version: async () => ({ protocol_version: 1, helper_version: 'test' }),
            buildProxyCommand: () => proxyCommand,
        },
        { instant: (message: string) => message },
        { create: () => logger },
        injector,
    )
    assert.equal(resolutions, 0, 'registry lookup must be lazy to avoid circular injection')
    return { provider, logs }
}

test('uses the registered native SSH component and retains authentication and transport', async () => {
    class RegisteredSSHTab {}
    let nativeProfile: any
    const expected = { type: RegisteredSSHTab, inputs: {}, customProviderOption: true }
    const { provider, logs } = createProvider({
        getNewTabParameters: async (profile: any) => {
            nativeProfile = profile
            return expected
        },
    })
    const source = {
        id: 'fknat:test', type: 'fknat-ssh', name: '2222', options: {
            address, user: 'root', auth: 'publicKey', privateKeys: [], password: 'secret-test-password',
        },
    }
    assert.equal(await provider.getNewTabParameters(source), expected)
    assert.equal(nativeProfile.options.host, address)
    assert.equal(nativeProfile.options.proxyCommand, proxyCommand)
    assert.equal(nativeProfile.options.auth, 'publicKey')
    assert.deepEqual(nativeProfile.options.privateKeys, [], 'retain native automatic key discovery')
    const logged = JSON.stringify(logs)
    assert.match(logged, /automatic discovery/)
    assert.match(logged, /RegisteredSSHTab/)
    assert.equal(logged.includes(source.options.password), false)
    assert.equal(logged.includes(address), false)
})

test('reports an unavailable native SSH plugin clearly', async () => {
    const { provider } = createProvider(null)
    await assert.rejects(provider.getNewTabParameters({
        type: 'fknat-ssh', name: '2222', options: { address, user: 'root' },
    }), /native Tabby SSH plugin is not available/)
})
