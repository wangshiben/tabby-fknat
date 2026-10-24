import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const targets = [
    ['windows', 'amd64', 'win32-x64', '.exe'],
    ['windows', 'arm64', 'win32-arm64', '.exe'],
    ['linux', 'amd64', 'linux-x64', ''],
    ['linux', 'arm64', 'linux-arm64', ''],
    ['darwin', 'amd64', 'darwin-x64', ''],
    ['darwin', 'arm64', 'darwin-arm64', ''],
]
const manifest = {}
for (const [goos, goarch, directory, suffix] of targets) {
    const outputDirectory = join(root, 'bin', directory)
    await mkdir(outputDirectory, { recursive: true })
    const output = join(outputDirectory, `fknat-tabby-helper${suffix}`)
    // ProxyCommand supplies inherited stdin/stdout handles, so the helper can
    // use the Windows GUI subsystem without opening a visible console window.
    const ldflags = goos === 'windows' ? '-s -w -H=windowsgui' : '-s -w'
    execFileSync('go', ['build', '-trimpath', '-ldflags', ldflags, '-o', output, './cmd/fknat-tabby-helper'], {
        cwd: join(root, 'helper'),
        env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
        stdio: 'inherit',
    })
    const hash = createHash('sha256').update(await readFile(output)).digest('hex')
    manifest[directory] = `sha256:${hash}`
}
await writeFile(join(root, 'bin', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 })
