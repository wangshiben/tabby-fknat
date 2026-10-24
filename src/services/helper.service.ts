import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Injectable } from '@angular/core'
import type { ConfigService, Logger } from 'tabby-core'
import type { FKNATTranslator } from '../i18n'
import { defaultFKNATConfig, FKNATPluginConfig } from '../models/config'
import { buildShellCommand, ShellPlatform } from '../utils/quoting'
import { parseHelperError } from '../utils/errors'
import { FKNATPlatformService } from './platform.service'

export interface HelperVersion {
    helper_version: string
    protocol_version: number
    fknat_version?: string
}

export interface DoctorResult {
    ok: boolean
    helper_version?: string
    protocol_version?: number
    network_status?: string
    relay_address?: string
    route_available?: boolean
}

type HelperLogger = Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>

const silentLogger: HelperLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
}

const HELPER_COMMAND_GRACE_MS = 5000

@Injectable()
export class HelperService {
    private readonly log: HelperLogger

    constructor (
        private readonly platform: FKNATPlatformService,
        private readonly tabbyConfig: ConfigService,
        private readonly i18n: FKNATTranslator,
        logger?: Logger,
    ) {
        this.log = logger ?? silentLogger
        this.log.debug('HelperService constructed', {
            platform: process.platform,
            arch: process.arch,
            helperPathOverride: this.config.helperPathOverride ?? null,
            logLevel: this.config.logLevel,
            connectionTimeoutSeconds: this.config.connectionTimeoutSeconds,
        })
    }

    private get config (): FKNATPluginConfig {
        return { ...defaultFKNATConfig, ...(this.tabbyConfig.store?.fknat ?? {}) }
    }

    getHelperPath (): string {
        return this.platform.getHelperPath(this.config.helperPathOverride)
    }

    async assertExecutable (): Promise<void> {
        const helperPath = this.getHelperPath()
        this.log.debug('Checking FKNAT helper', { helperPath })
        let stat
        try {
            stat = await fs.stat(helperPath)
        } catch (error) {
            this.log.error('FKNAT helper stat failed', { helperPath, error: describeError(error) })
            throw error
        }
        if (!stat.isFile()) {
            this.log.error('FKNAT helper path is not a file', { helperPath })
            throw new Error(this.i18n.instant('FKNAT helper path is not a file'))
        }
        if (this.config.helperPathOverride && process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
            this.log.error('FKNAT helper is not executable', { helperPath, mode: stat.mode.toString(8) })
            throw new Error(this.i18n.instant('FKNAT helper is not executable'))
        }
        if (this.config.helperPathOverride) {
            this.log.info('Using overridden FKNAT helper', { helperPath })
            return
        }
        const platform = path.basename(path.dirname(helperPath))
        const manifestPath = path.join(path.dirname(helperPath), '..', 'manifest.json')
        let manifest: Record<string, string>
        try {
            manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, string>
        } catch (error) {
            this.log.error('FKNAT helper manifest read failed', {
                helperPath,
                manifestPath,
                error: describeError(error),
            })
            throw error
        }
        const expected = manifest[platform]
        if (!expected?.startsWith('sha256:')) {
            this.log.error('FKNAT helper checksum is missing', { helperPath, manifestPath, platform })
            throw new Error(this.i18n.instant('FKNAT helper checksum is missing for {platform}', { platform }))
        }
        const actual = createHash('sha256').update(await fs.readFile(helperPath)).digest('hex')
        if (expected !== `sha256:${actual}`) {
            this.log.error('FKNAT helper checksum mismatch', {
                helperPath,
                manifestPath,
                platform,
                expected,
                actual: `sha256:${actual}`,
            })
            throw new Error(this.i18n.instant('FKNAT helper checksum verification failed'))
        }
        this.log.debug('FKNAT helper checksum verified', { helperPath, platform, checksum: expected })
        // Archives produced on Windows can lose POSIX execute bits. Restore only
        // the bundled helper's owner execute bit after verifying its contents.
        if (process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
            await fs.chmod(helperPath, stat.mode | 0o100)
            this.log.info('Restored execute permission on verified FKNAT helper', { helperPath })
        }
    }

    buildProxyCommand (address: string, shellPlatform: ShellPlatform = process.platform === 'win32' ? 'win32' : 'posix'): string {
        const helper = this.getHelperPath()
        const configDir = this.platform.getDataDirectory()
        return buildShellCommand(helper, [
            'connect', '--config-dir', configDir, '--server-id', address,
            '--timeout', `${this.config.connectionTimeoutSeconds}s`,
        ], shellPlatform)
    }

    async version (): Promise<HelperVersion> {
        this.log.info('Checking FKNAT helper version')
        const result = await this.run(['version', '--json'])
        try {
            const version = JSON.parse(result.stdout) as HelperVersion
            this.log.info('FKNAT helper version received', version)
            return version
        } catch (error) {
            this.log.error('FKNAT helper returned invalid version JSON', {
                error: describeError(error),
                stdoutLength: result.stdout.length,
                stderrLength: result.stderr.length,
            })
            throw error
        }
    }

    async doctor (address?: string): Promise<DoctorResult> {
        const args = ['doctor', '--config-dir', this.platform.getDataDirectory()]
        if (address) args.push('--server-id', address)
        this.log.info('Running FKNAT helper doctor', {
            address: address ?? null,
            dataDirectory: this.platform.getDataDirectory(),
        })
        const result = await this.run(args)
        try {
            const doctor = JSON.parse(result.stdout) as DoctorResult
            this.log.info('FKNAT helper doctor completed', doctor)
            return doctor
        } catch (error) {
            this.log.error('FKNAT helper returned invalid doctor JSON', {
                error: describeError(error),
                stdoutLength: result.stdout.length,
                stderrLength: result.stderr.length,
            })
            throw error
        }
    }

    private async run (args: string[]): Promise<{ stdout: string, stderr: string }> {
        await this.assertExecutable()
        const dataDirectory = this.platform.getDataDirectory()
        await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 })
        const helperPath = this.getHelperPath()
        const timeoutSeconds = normalizeTimeoutSeconds(this.config.connectionTimeoutSeconds)
        const timeoutMs = timeoutSeconds * 1000 + HELPER_COMMAND_GRACE_MS
        const command = args[0] ?? '<empty>'
        this.log.debug('Starting FKNAT helper command', {
            helperPath,
            command,
            args: redactArgs(args),
            cwd: dataDirectory,
            timeoutMs,
            logLevel: this.config.logLevel,
        })
        return new Promise((resolve, reject) => {
            const startedAt = Date.now()
            let settled = false
            let timedOut = false
            let timer: NodeJS.Timeout | undefined
            const child = spawn(helperPath, args, {
                cwd: dataDirectory,
                env: { ...process.env, FKNAT_TABBY_LOG_LEVEL: this.config.logLevel },
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            let stdout = ''
            let stderr = ''
            child.stdout.on('data', chunk => { stdout += chunk.toString() })
            child.stderr.on('data', chunk => { stderr += chunk.toString() })
            const clear = () => {
                if (timer) clearTimeout(timer)
                timer = undefined
            }
            child.once('error', error => {
                clear()
                if (settled) return
                settled = true
                this.log.error('FKNAT helper spawn failed', {
                    helperPath,
                    command,
                    error: describeError(error),
                    elapsedMs: Date.now() - startedAt,
                })
                reject(error)
            })
            child.once('close', (code, signal) => {
                clear()
                const elapsedMs = Date.now() - startedAt
                this.log.debug('FKNAT helper process closed', {
                    helperPath,
                    command,
                    code,
                    signal,
                    timedOut,
                    elapsedMs,
                    stdoutLength: stdout.length,
                    stderrLength: stderr.length,
                })
                if (settled) return
                settled = true
                if (code !== 0) {
                    const parsed = parseHelperError(stderr)
                    const message = parsed
                        ? this.i18n.instant(parsed.message)
                        : this.i18n.instant('FKNAT helper exited with status {status}', { status: code })
                    this.log.error('FKNAT helper exited unsuccessfully', {
                        helperPath,
                        command,
                        code,
                        signal,
                        elapsedMs,
                        parsedCode: parsed?.code ?? null,
                        stderr: truncateForLog(stderr),
                    })
                    reject(new Error(message))
                    return
                }
                this.log.info('FKNAT helper command completed', {
                    command,
                    elapsedMs,
                    stdoutLength: stdout.length,
                    stderrLength: stderr.length,
                    stderr: stderr ? truncateForLog(stderr) : undefined,
                })
                resolve({ stdout, stderr })
            })
            timer = setTimeout(() => {
                if (settled) return
                timedOut = true
                this.log.error('FKNAT helper command timed out', {
                    helperPath,
                    command,
                    timeoutMs,
                    elapsedMs: Date.now() - startedAt,
                })
                child.kill()
                settled = true
                reject(new Error(this.i18n.instant('FKNAT helper command timed out after {seconds}s', {
                    seconds: Math.ceil(timeoutMs / 1000),
                })))
            }, timeoutMs)
        })
    }
}

function normalizeTimeoutSeconds (value: number): number {
    if (!Number.isFinite(value)) return 30
    return Math.min(300, Math.max(5, Math.ceil(value)))
}

function redactArgs (args: string[]): string[] {
    return args.map((arg, index) => {
        if (args[index - 1] === '--server-id') return `${arg.slice(0, 8)}…${arg.slice(-8)}`
        return arg
    })
}

function truncateForLog (value: string, max = 2048): string {
    return value.length <= max ? value : `${value.slice(0, max)}…[truncated ${value.length - max} bytes]`
}

function describeError (error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
