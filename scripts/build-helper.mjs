import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createSDKCompatibilityBuild } from './sdk-compat.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const releaseGoEnvironment = {
    ...process.env,
    GOPROXY: 'https://proxy.golang.com.cn',
    GONOPROXY: 'none',
    GOPRIVATE: '',
    GONOSUMDB: '',
    GOTOOLCHAIN: 'go1.25.0',
    GOWORK: 'off',
    GOVCS: '*:off',
}
const targets = [
    ['windows', 'amd64', 'win32-x64', '.exe'],
    ['windows', 'arm64', 'win32-arm64', '.exe'],
    ['linux', 'amd64', 'linux-x64', ''],
    ['linux', 'arm64', 'linux-arm64', ''],
    ['darwin', 'amd64', 'darwin-x64', ''],
    ['darwin', 'arm64', 'darwin-arm64', ''],
]
const manifest = {}
console.log('Preparing Windows compatibility patch for published natP2pSDK v0.0.2')
const sdkBuild = await createSDKCompatibilityBuild(join(root, 'helper'), releaseGoEnvironment)
try {
    console.log('Testing published SDK billing-key permissions')
    execFileSync('go', ['test', '-mod=readonly', '-modfile', sdkBuild.modfile,
        'github.com/wangshiben/natP2pSDK/internal/core/admission/nodeconfig', '-run', '^TestTabbyBillingKeyFileMode$', '-count=1'], {
        cwd: join(root, 'helper'), env: releaseGoEnvironment, stdio: 'inherit',
    })
    console.log('Testing helper')
    execFileSync('go', ['test', '-mod=readonly', '-modfile', sdkBuild.modfile, './...'], {
        cwd: join(root, 'helper'), env: releaseGoEnvironment, stdio: 'inherit',
    })
    for (const [goos, goarch, directory, suffix] of targets) {
        console.log(`Building helper ${version} for ${directory}`)
        const outputDirectory = join(root, 'bin', directory)
        await mkdir(outputDirectory, { recursive: true })
        const output = join(outputDirectory, `fknat-tabby-helper${suffix}`)
        // ProxyCommand supplies inherited stdin/stdout handles, so the helper can
        // use the Windows GUI subsystem without opening a visible console window.
        const ldflags = `-s -w -X main.helperVersion=${version}${goos === 'windows' ? ' -H=windowsgui' : ''}`
        execFileSync('go', ['build', '-mod=readonly', '-modfile', sdkBuild.modfile, '-trimpath', '-ldflags', ldflags, '-o', output, './cmd/fknat-tabby-helper'], {
            cwd: join(root, 'helper'),
            env: { ...releaseGoEnvironment, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
            stdio: 'inherit',
        })
        const hash = createHash('sha256').update(await readFile(output)).digest('hex')
        manifest[directory] = `sha256:${hash}`
    }
    await writeFile(join(root, 'bin', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 })
} finally {
    await sdkBuild.close()
}
