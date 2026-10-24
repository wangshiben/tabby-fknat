import { PartialProfile } from 'tabby-core'
import type { SSHProfile } from 'tabby-ssh'
import { ConnectableTerminalProfile } from 'tabby-terminal'
import { LoginScript } from 'tabby-terminal'
import { normalizeFKNATAddress } from '../utils/address'

export interface FKNATSSHProfileOptions {
    address: string
    port?: number
    user: string
    auth?: null | 'password' | 'publicKey' | 'agent' | 'keyboardInteractive'
    password?: string
    privateKeys?: string[]
    keepaliveInterval?: number
    keepaliveCountMax?: number
    readyTimeout?: number
    x11?: boolean
    skipBanner?: boolean
    agentForward?: boolean
    warnOnClose?: boolean
    algorithms?: Record<string, string[]>
    forwardedPorts?: SSHProfile['options']['forwardedPorts']
    scripts?: LoginScript[]
    reuseSession?: boolean
    input?: SSHProfile['options']['input']
    fknatProfileVersion?: 1
}

export interface FKNATSSHProfile extends ConnectableTerminalProfile {
    type: 'fknat-ssh'
    options: FKNATSSHProfileOptions
}

export const TABBY_SSH_DEFAULT_ALGORITHMS: Record<string, string[]> = {
    kex: [
        'mlkem768x25519-sha256',
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'diffie-hellman-group16-sha512',
        'diffie-hellman-group14-sha256',
        'ext-info-c',
        'ext-info-s',
        'kex-strict-c-v00@openssh.com',
        'kex-strict-s-v00@openssh.com',
    ],
    serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-256',
        'rsa-sha2-512',
        'ssh-rsa',
    ],
    cipher: [
        'chacha20-poly1305@openssh.com',
        'aes256-gcm@openssh.com',
        'aes256-ctr',
        'aes192-ctr',
        'aes128-ctr',
    ],
    hmac: [
        'hmac-sha2-512-etm@openssh.com',
        'hmac-sha2-256-etm@openssh.com',
        'hmac-sha2-512',
        'hmac-sha2-256',
        'hmac-sha1-etm@openssh.com',
        'hmac-sha1',
    ],
    compression: ['none'],
}

function withSSHAlgorithmDefaults (overrides?: Record<string, string[]>): Record<string, string[]> {
    return Object.fromEntries(Object.entries(TABBY_SSH_DEFAULT_ALGORITHMS).map(([key, values]) => [
        key,
        [...(overrides?.[key] ?? values)],
    ]))
}

export function toNativeSSHProfile (
    profile: FKNATSSHProfile,
    proxyCommand: string,
): SSHProfile {
    const address = normalizeFKNATAddress(profile.options.address)
    return {
        ...profile,
        type: 'ssh',
        clearServiceMessagesOnConnect: profile.clearServiceMessagesOnConnect ?? true,
        options: {
            host: address,
            port: profile.options.port ?? 22,
            user: profile.options.user || 'root',
            auth: profile.options.auth ?? null,
            password: profile.options.password,
            privateKeys: profile.options.privateKeys ?? [],
            keepaliveInterval: profile.options.keepaliveInterval ?? 5000,
            keepaliveCountMax: profile.options.keepaliveCountMax ?? 10,
            readyTimeout: profile.options.readyTimeout,
            x11: profile.options.x11 ?? false,
            skipBanner: profile.options.skipBanner ?? false,
            agentForward: profile.options.agentForward ?? false,
            warnOnClose: profile.options.warnOnClose,
            algorithms: withSSHAlgorithmDefaults(profile.options.algorithms),
            proxyCommand,
            forwardedPorts: profile.options.forwardedPorts ?? [],
            scripts: profile.options.scripts ?? [],
            reuseSession: profile.options.reuseSession ?? true,
            input: profile.options.input ?? { backspace: 'backspace' },
        },
    }
}

export function parseFKNATQuickConnect (query: string): PartialProfile<FKNATSSHProfile> | null {
    const match = /^fknat:\/\/(?:([^@/?#]+)@)?([^/?#]+)\/?$/i.exec(query.trim())
    if (!match) {
        return null
    }
    let address: string
    try {
        address = normalizeFKNATAddress(match[2])
    } catch {
        return null
    }
    let user: string
    try {
        user = match[1] ? decodeURIComponent(match[1]) : 'root'
    } catch {
        return null
    }
    if (!user || /[\x00-\x1f\x7f]/.test(user)) {
        return null
    }
    return {
        type: 'fknat-ssh',
        name: `${user}@${address.slice(0, 12)}...`,
        options: {
            address,
            port: 22,
            user,
            auth: null,
            privateKeys: [],
            fknatProfileVersion: 1,
        },
    }
}
