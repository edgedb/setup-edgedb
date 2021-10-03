import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
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

  let projectLink: string | null = core.getInput('project-link')
  if (projectLink === '' || projectLink === 'false') {
    projectLink = null
  }

  let instanceName: string | null = core.getInput('instance-name')
  if (instanceName === '') {
    instanceName = null
  }

  try {
    const cliPath = await installCLI(cliVersion)

    if (projectLink) {
      core.addPath(cliPath)

      await linkProject(projectLink, instanceName)

      return
    }

    if (serverVersion) {
      const serverPath = await installServer(serverVersion, cliPath)
      core.addPath(serverPath)

      core.addPath(cliPath)

      if (isRunningInsideProject()) {
        await initProject(instanceName, serverVersion)
      } else if (instanceName) {
        await createNamedInstance(instanceName, serverVersion)
      }
    } else {
      core.addPath(cliPath)
    }
  } catch (error) {
    core.setFailed(error.message)
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

  const cmdline = ['--method', 'package']
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

  const infoCmdline = ['server', 'info', '--bin-path'].concat(cmdline)
  core.debug(`Running ${cli} ${infoCmdline.join(' ')}`)
  await exec.exec(cli, infoCmdline, infoOptions)

  serverBinPath = fs.realpathSync(serverBinPath)
  return path.dirname(serverBinPath)
}

async function installCLI(requestedCliVersion: string): Promise<string> {
  const arch = os.arch()
  const includeCliPrereleases = true
  let cliVersionRange = '*'
  let dist = getBaseDist(arch, os.platform())

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

export function getBaseDist(arch: string, platform: string): string {
  let distArch = ''
  let distPlatform = ''

  if (platform === 'linux') {
    distPlatform = platform
  } else if (platform === 'darwin') {
    distPlatform = 'macos'
  } else {
    throw Error(`This action cannot be run on ${platform}`)
  }

  if (arch === 'x64') {
    distArch = 'x86_64'
  } else {
    throw Error(`This action does not support the ${arch} architecture`)
  }

  return `${distPlatform}-${distArch}`
}

async function linkProject(
  dsn: string,
  instanceName: string | null
): Promise<void> {
  instanceName = instanceName || generateIntanceName()

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

  const projectLinkCmdLine = [
    'project',
    'init',
    '--non-interactive',
    '--link',
    '--server-instance',
    instanceName
  ]
  core.debug(`Running ${cli} ${projectLinkCmdLine.join(' ')}`)
  await exec.exec(cli, projectLinkCmdLine, options)
}

async function initProject(
  instanceName: string | null,
  serverVersion: string
): Promise<void> {
  instanceName = instanceName || generateIntanceName()

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

  const cmdOptionsLine = ['--server-instance', instanceName]
  if (serverVersion && serverVersion !== 'stable') {
    cmdOptionsLine.push('--server-version', serverVersion)
  }

  const cmdLine = ['project', 'init', '--non-interactive'].concat(
    cmdOptionsLine
  )
  core.debug(`Running ${cli} ${cmdLine.join(' ')}`)
  await exec.exec(cli, cmdLine, options)
}

async function createNamedInstance(
  instanceName: string,
  serverVersion: string
): Promise<void> {
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

  const cmdOptionsLine = []
  if (serverVersion === 'nightly') {
    cmdOptionsLine.push('--nightly')
  } else if (serverVersion && serverVersion !== 'stable') {
    cmdOptionsLine.push('--version', serverVersion)
  }

  const cmdLine = ['instance', 'create', instanceName].concat(cmdOptionsLine)
  core.debug(`Running ${cli} ${cmdLine.join(' ')}`)
  await exec.exec(cli, cmdLine, options)
}

function isRunningInsideProject(): boolean {
  try {
    fs.accessSync('edgedb.toml')
    return true
  } catch (error) {
    return false
  }
}

function generateIntanceName(): string {
  const start = 1000
  const end = 9999
  const suffix = Math.floor(Math.random() * (end - start) + start)
  return `ghactions_${suffix}`
}
