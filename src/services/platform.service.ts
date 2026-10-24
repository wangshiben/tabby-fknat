import * as path from 'node:path'
import * as os from 'node:os'
import { Injectable } from '@angular/core'

export type HelperPlatform = 'win32-x64' | 'win32-arm64' | 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64'

export function currentHelperPlatform (platform = process.platform, arch = process.arch): HelperPlatform {
    const supported = new Set<HelperPlatform>([
        'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64',
    ])
    const key = `${platform}-${arch === 'ia32' ? 'x86' : arch}`
    if (key === 'win32-x86') {
        throw new Error('FKNAT helper does not support 32-bit Windows')
    }
    if (!supported.has(key as HelperPlatform)) {
        throw new Error(`Unsupported FKNAT helper platform: ${key}`)
    }
    return key as HelperPlatform
}

export function bundledHelperPath (
    moduleDirectory: string,
    platform = process.platform,
    arch = process.arch,
): string {
    const packageRoot = path.basename(moduleDirectory) === 'dist'
        ? path.dirname(moduleDirectory)
        : path.resolve(moduleDirectory, '..', '..')
    const target = currentHelperPlatform(platform, arch)
    const suffix = platform === 'win32' ? '.exe' : ''
    return path.join(packageRoot, 'bin', target, `fknat-tabby-helper${suffix}`)
}

@Injectable({ providedIn: 'root' })
export class FKNATPlatformService {
    getDataDirectory (): string {
        const base = os.homedir() || process.env.HOME || process.env.USERPROFILE || '.'
        if (process.platform === 'win32') {
            return path.join(process.env.APPDATA ?? path.join(base, 'AppData', 'Roaming'), 'tabby-fknat')
        }
        if (process.platform === 'darwin') {
            return path.join(base, 'Library', 'Application Support', 'tabby-fknat')
        }
        return path.join(process.env.XDG_CONFIG_HOME ?? path.join(base, '.config'), 'tabby-fknat')
    }

    getHelperPath (override?: string | null): string {
        if (override?.trim()) {
            return override.trim()
        }
        return bundledHelperPath(__dirname)
    }

    getBillingPath (): string {
        return path.join(this.getDataDirectory(), 'secrets', 'billing.json')
    }

    getIdentityPath (): string {
        return path.join(this.getDataDirectory(), 'client.identity')
    }
}
