export const FKNAT_ADDRESS_PATTERN = /^[0-9a-fA-F]{64}$/

export function normalizeFKNATAddress (value: string): string {
    const address = value.trim()
    if (!FKNAT_ADDRESS_PATTERN.test(address)) {
        throw new Error('FKNAT Address must be exactly 64 hexadecimal characters')
    }
    return address.toLowerCase()
}

export function isFKNATAddress (value: string): boolean {
    try {
        normalizeFKNATAddress(value)
        return true
    } catch {
        return false
    }
}
