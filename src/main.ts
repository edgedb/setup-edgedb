import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import * as io from '@actions/io'
import * as cp from 'child_process'
import * as tc from '@actions/tool-cache'
import * as fs from 'fs'
import * as fetch from 'node-fetch'
import * as os from 'os'
import * as path from 'path'
import * as semver from 'semver'

export const EDGEDB_PKG_ROOT = 'https://packages.edgedb.com'
const EDGEDB_PKG_IDX = `${EDGEDB_PKG_ROOT}/archive/.jsonindexes`

export async function run(): Promise<void> {
  const cliVersion = core.getInput('cli-version')

  let serverVersion: string | null = core.getInput('server-version')
  if (serverVersion === '' || serverVersion === 'none') {
    serverVersion = null
  }

  let serverDsn: string | null = core.getInput('server-dsn')
  if (serverDsn === '' || serverDsn === 'false' || serverDsn === 'none') {
    serverDsn = null
  }

  let instanceName: string | null = core.getInput('instance-name')
  if (instanceName === '') {
    instanceName = null
  }

  let projectDir: string | null = core.getInput('project-dir')
  if (projectDir === '') {
    projectDir = null
  }

  try {
    const cliPath = await installCLI(cliVersion)

    if (serverDsn) {
      core.addPath(cliPath)
      await linkInstance(serverDsn, instanceName, projectDir)
    } else if (serverVersion) {
      const serverPath = await installServer(serverVersion, cliPath)
      core.addPath(serverPath)

      core.addPath(cliPath)

      const runstateDir = generateRunstateDir()
      if (hasProjectFile(projectDir)) {
        await initProject(projectDir, instanceName, serverVersion, runstateDir)
        core.setOutput('runstate-dir', runstateDir)
      } else if (instanceName) {
        await createNamedInstance(instanceName, serverVersion, runstateDir)
        core.setOutput('runstate-dir', runstateDir)
      }
    } else {
      core.addPath(cliPath)
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

async function installServer(
  requestedVersion: string | null,
  cliPath: string
): Promise<string> {
  const options: ExecOptions = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        core.debug(data.toString().trim())
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const cmdline = []
  const cli = path.join(cliPath, 'edgedb')

  if (requestedVersion === 'nightly') {
    cmdline.push('--nightly')
  } else if (requestedVersion && requestedVersion !== 'stable') {
    cmdline.push('--version')
    cmdline.push(requestedVersion)
  }

  const installCmdline = ['server', 'install'].concat(cmdline)
  core.debug(`Running ${cli} ${installCmdline.join(' ')}`)
  await exec.exec(cli, installCmdline, options)

  let serverBinPath = ''

  const infoOptions: ExecOptions = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        serverBinPath = data.toString().trim()
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  if (cmdline.length === 0) {
    cmdline.push('--latest')
  }

  const infoCmdline = ['server', 'info', '--bin-path'].concat(cmdline)
  core.debug(`Running ${cli} ${infoCmdline.join(' ')}`)
  await exec.exec(cli, infoCmdline, infoOptions)

  serverBinPath = fs.realpathSync(serverBinPath)
  return path.dirname(serverBinPath)
}

async function installCLI(requestedCliVersion: string): Promise<string> {
  const arch = os.arch()
  const platform = os.platform()
  const includeCliPrereleases = true
  let cliVersionRange = '*'
  let libc = ''
  if (platform === 'linux') {
    libc = 'musl'
  }
  let dist = getBaseDist(arch, platform, libc)

  if (requestedCliVersion === 'nightly') {
    dist += '.nightly'
  } else if (requestedCliVersion !== 'stable') {
    cliVersionRange = requestedCliVersion
  }

  const versionMap = await getVersionMap(dist)
  const matchingVer = await getMatchingVer(
    versionMap,
    cliVersionRange,
    includeCliPrereleases
  )

  let cliDirectory = tc.find('edgedb-cli', matchingVer, arch)
  if (!cliDirectory) {
    const cliPkg = versionMap.get(matchingVer)
    const downloadUrl = new URL(cliPkg.installref, EDGEDB_PKG_ROOT).href
    core.info(
      `Downloading edgedb-cli ${matchingVer} - ${arch} from ${downloadUrl}`
    )
    const downloadPath = await tc.downloadTool(downloadUrl)
    fs.chmodSync(downloadPath, 0o755)
    cliDirectory = await tc.cacheFile(
      downloadPath,
      'edgedb',
      'edgedb-cli',
      matchingVer,
      arch
    )
  }

  return cliDirectory
}

export async function getMatchingVer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  versionMap: Map<string, any>,
  cliVersionRange: string,
  includeCliPrereleases: boolean
): Promise<string> {
  const versions = Array.from(versionMap.keys()).filter(ver =>
    semver.satisfies(ver, cliVersionRange, {
      includePrerelease: includeCliPrereleases
    })
  )
  versions.sort(semver.compareBuild)
  if (versions.length > 0) {
    return versions[versions.length - 1]
  } else {
    throw Error(
      'no published EdgeDB CLI version matches requested version ' +
        `'${cliVersionRange}'`
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getVersionMap(dist: string): Promise<Map<string, any>> {
  const indexRequest = await fetch.default(`${EDGEDB_PKG_IDX}/${dist}.json`)
  const index = await indexRequest.json()
  const versionMap = new Map()

  for (const pkg of index.packages) {
    if (pkg.name !== 'edgedb-cli') {
      continue
    }

    if (
      !versionMap.has(pkg.version) ||
      versionMap.get(pkg.version).revision < pkg.revision
    ) {
      versionMap.set(pkg.version, pkg)
    }
  }

  return versionMap
}

export function getBaseDist(arch: string, platform: string, libc = ''): string {
  let distArch = ''
  let distPlatform = ''

  if (platform === 'linux') {
    if (libc === '') {
      libc = 'gnu'
    }
    distPlatform = `unknown-linux-${libc}`
  } else if (platform === 'darwin') {
    distPlatform = 'apple-darwin'
  } else {
    throw Error(`This action cannot be run on ${platform}`)
  }

  if (arch === 'x64') {
    distArch = 'x86_64'
  } else {
    throw Error(`This action does not support the ${arch} architecture`)
  }

  return `${distArch}-${distPlatform}`
}

async function linkInstance(
  dsn: string,
  instanceName: string | null,
  projectDir: string | null
): Promise<void> {
  instanceName = instanceName || generateInstanceName()

  const cli = 'edgedb'
  const options: ExecOptions = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        core.debug(data.toString().trim())
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const instanceLinkCmdLine = [
    'instance',
    'link',
    '--non-interactive',
    '--trust-tls-cert',
    '--dsn',
    dsn,
    instanceName
  ]
  core.debug(`Running ${cli} ${instanceLinkCmdLine.join(' ')}`)
  await exec.exec(cli, instanceLinkCmdLine, options)

  if (hasProjectFile(projectDir)) {
    const projectLinkCmdLine = [
      'project',
      'init',
      '--non-interactive',
      '--link',
      '--server-instance',
      instanceName
    ]

    if (projectDir) {
      projectLinkCmdLine.push('--project-dir', projectDir)
    }

    core.debug(`Running ${cli} ${projectLinkCmdLine.join(' ')}`)
    await exec.exec(cli, projectLinkCmdLine, options)
  }
}

async function initProject(
  projectDir: string | null,
  instanceName: string | null,
  serverVersion: string,
  runstateDir: string
): Promise<void> {
  instanceName = instanceName || generateInstanceName()

  const cli = 'edgedb'
  const options: ExecOptions = {
    silent: true,
    env: {
      XDG_RUNTIME_DIR: runstateDir
    },
    listeners: {
      stdout: (data: Buffer) => {
        core.debug(data.toString().trim())
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const cmdOptionsLine = [
    '--non-interactive',
    '--server-start-conf',
    'manual',
    '--server-instance',
    instanceName
  ]
  if (serverVersion && serverVersion !== 'stable') {
    cmdOptionsLine.push('--server-version', serverVersion)
  }
  if (projectDir) {
    cmdOptionsLine.push('--project-dir', projectDir)
  }

  const cmdLine = ['project', 'init'].concat(cmdOptionsLine)
  core.debug(`Running ${cli} ${cmdLine.join(' ')}`)
  await exec.exec(cli, cmdLine, options)

  await startInstance(instanceName, runstateDir)
}

async function createNamedInstance(
  instanceName: string,
  serverVersion: string,
  runstateDir: string
): Promise<void> {
  const cli = 'edgedb'

  const options: ExecOptions = {
    silent: true,
    env: {
      XDG_RUNTIME_DIR: runstateDir
    },
    listeners: {
      stdout: (data: Buffer) => {
        core.debug(data.toString().trim())
      },
      stderr: (data: Buffer) => {
        core.debug(data.toString().trim())
      }
    }
  }

  const cmdOptionsLine = ['--start-conf', 'manual']
  if (serverVersion === 'nightly') {
    cmdOptionsLine.push('--nightly')
  } else if (serverVersion && serverVersion !== 'stable') {
    cmdOptionsLine.push('--version', serverVersion)
  }

  const cmdLine = ['instance', 'create', instanceName].concat(cmdOptionsLine)
  core.debug(`Running ${cli} ${cmdLine.join(' ')}`)
  await exec.exec(cli, cmdLine, options)

  await startInstance(instanceName, runstateDir)
}

async function startInstance(
  instanceName: string,
  runstateDir: string
): Promise<void> {
  const cli = 'edgedb'

  const options: ExecOptions = {
    env: {
      XDG_RUNTIME_DIR: runstateDir
    }
  }

  const cmdLine = ['instance', 'start', '--foreground', instanceName]
  core.debug(`Running ${cli} ${cmdLine.join(' ')} in background`)
  await backgroundExec(cli, cmdLine, options)
}

function hasProjectFile(projectDir: string | null): boolean {
  const manifestPath = path.join(projectDir || '', 'edgedb.toml')

  try {
    fs.accessSync(manifestPath)
    return true
  } catch (error) {
    return false
  }
}

function generateInstanceName(): string {
  const start = 1000
  const end = 9999
  const suffix = Math.floor(Math.random() * (end - start) + start)
  return `ghactions_${suffix}`
}

function generateRunstateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edgedb-server-'))
}

async function backgroundExec(
  command: string,
  args: string[],
  options: ExecOptions
): Promise<void> {
  command = await io.which(command, true)

  const spawnOptions: cp.SpawnOptions = {
    stdio: 'ignore',
    detached: true,
    env: options.env
  }

  const serverProcess = cp.spawn(command, args, spawnOptions)
  serverProcess.unref()
}
