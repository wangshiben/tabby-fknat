export type ShellPlatform = 'win32' | 'posix'

export function quotePOSIXArgument (value: string): string {
    if (value.length === 0) {
        return "''"
    }
    return `'${value.replace(/'/g, `'"'"'`)}'`
}

// Tabby passes proxyCommand to the platform shell. cmd.exe parsing requires
// embedded quotes to be doubled and shell metacharacters to stay quoted.
export function quoteWindowsArgument (value: string): string {
    return `"${value.replace(/"/g, '""')}"`
}

export function quoteShellArgument (value: string, platform: ShellPlatform): string {
    return platform === 'win32' ? quoteWindowsArgument(value) : quotePOSIXArgument(value)
}

export function buildShellCommand (executable: string, args: string[], platform: ShellPlatform): string {
    return [executable, ...args].map(value => quoteShellArgument(value, platform)).join(' ')
}
