export interface FKNATPluginConfig {
    configVersion: 1
    helperPathOverride: string | null
    logLevel: 'error' | 'warn' | 'info' | 'debug'
    connectionTimeoutSeconds: number
}

export const defaultFKNATConfig: FKNATPluginConfig = {
    configVersion: 1,
    helperPathOverride: null,
    logLevel: 'warn',
    connectionTimeoutSeconds: 30,
}
