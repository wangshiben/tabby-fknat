export type HelperErrorCode =
    | 'INVALID_ARGUMENT'
    | 'BILLING_KEY_INVALID'
    | 'IDENTITY_ERROR'
    | 'ADDRESS_INVALID'
    | 'CA_ADMISSION_FAILED'
    | 'DISCOVERY_FAILED'
    | 'SERVER_OFFLINE'
    | 'ROUTE_REJECTED'
    | 'ROUTE_UNAVAILABLE'
    | 'NETWORK_FAILED'
    | 'BILLING_FAILED'
    | 'INTERNAL_ERROR'

const helperMessages: Record<HelperErrorCode, string> = {
    INVALID_ARGUMENT: 'The FKNAT helper received invalid connection settings.',
    BILLING_KEY_INVALID: 'Your FKNAT billing authorization is invalid. Import a new billing key.',
    IDENTITY_ERROR: 'The local FKNAT client identity could not be loaded or created.',
    ADDRESS_INVALID: 'The FKNAT Address is invalid.',
    CA_ADMISSION_FAILED: 'FKNAT network admission failed.',
    DISCOVERY_FAILED: 'FKNAT network discovery failed.',
    SERVER_OFFLINE: 'The FKNAT target is currently offline.',
    ROUTE_REJECTED: 'The target is online but does not expose the default FKNAT SSH route.',
    ROUTE_UNAVAILABLE: 'The FKNAT target is reachable, but its SSH route is not available.',
    NETWORK_FAILED: 'The FKNAT network connection failed.',
    BILLING_FAILED: 'FKNAT billing authorization failed.',
    INTERNAL_ERROR: 'The FKNAT helper failed unexpectedly.',
}

export function parseHelperError (stderr: string): { code: HelperErrorCode, message: string } | null {
    const match = /(?:^|\n)FKNAT_ERROR code=([A-Z_]+)/.exec(stderr)
    if (!match || !(match[1] in helperMessages)) {
        return null
    }
    const code = match[1] as HelperErrorCode
    return { code, message: helperMessages[code] }
}
