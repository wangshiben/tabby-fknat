import { readFile, writeFile, mkdtemp, rm, cp, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// natP2pSDK v0.0.2 applies Unix permission bits to Windows files, where Go
// synthesizes 0666 regardless of the ACL. Keep the published module pinned and
// patch a temporary copy of the published module. Go disallows source overlays
// inside GOMODCACHE; a temporary modfile keeps the checkout and cache untouched.
export function patchBillingKeyModeCheck (source) {
    const original = '\tif info.Mode().Perm()&0o077 != 0 {\n\t\treturn nil, fmt.Errorf("扣费私钥文件权限必须为 0600 或更严格")\n\t}'
    if (source.split(original).length !== 2 || !source.includes('\n\t"path/filepath"')) {
        throw new Error('Published SDK billing-key check changed; review the Windows compatibility patch')
    }
    return source.replace(original, original.replace('if ', 'if runtime.GOOS != "windows" && '))
        .replace('\n\t"path/filepath"', '\n\t"runtime"\n\t"path/filepath"')
}

export async function createSDKCompatibilityBuild (helperDirectory, environment) {
    const sdk = JSON.parse(execFileSync('go', ['list', '-mod=readonly', '-m', '-json', 'github.com/wangshiben/natP2pSDK'], {
        cwd: helperDirectory, env: environment, encoding: 'utf8', timeout: 120_000,
    }))
    if (sdk.Version !== 'v0.0.2' || sdk.Replace) {
        throw new Error('Review the SDK compatibility patch before changing the published SDK dependency')
    }
    const sourcePath = join(sdk.Dir, 'internal', 'core', 'admission', 'nodeconfig', 'nodeconfig.go')
    const patched = patchBillingKeyModeCheck((await readFile(sourcePath, 'utf8')).replace(/\r\n/g, '\n'))
    const directory = await mkdtemp(join(tmpdir(), 'tabby-fknat-sdk-'))
    try {
        const sdkDirectory = join(directory, 'sdk')
        await cp(sdk.Dir, sdkDirectory, { recursive: true })
        const patchedPath = join(sdkDirectory, 'internal', 'core', 'admission', 'nodeconfig', 'nodeconfig.go')
        await chmod(patchedPath, 0o644)
        await writeFile(patchedPath, patched)
        const testSource = fileURLToPath(new URL('./fixtures/billing-key-mode_test.go', import.meta.url))
        const testTarget = join(sdkDirectory, 'internal', 'core', 'admission', 'nodeconfig', 'tabby_billing_key_mode_test.go')
        await cp(testSource, testTarget)
        const modfile = join(directory, 'helper.mod')
        await writeFile(modfile, await readFile(join(helperDirectory, 'go.mod')))
        await writeFile(join(directory, 'helper.sum'), await readFile(join(helperDirectory, 'go.sum')))
        execFileSync('go', ['mod', 'edit', '-modfile', modfile,
            `-replace=github.com/wangshiben/natP2pSDK=${sdkDirectory}`], {
            cwd: helperDirectory, env: environment, stdio: 'inherit', timeout: 30_000,
        })
        return { modfile, close: () => rm(directory, { recursive: true, force: true }) }
    } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
    }
}
