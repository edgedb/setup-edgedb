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
  try {
    const cliVersion = core.getInput('cli-version')
    const cliPath = await installCLI(cliVersion)

    const serverVersion = core.getInput('server-version')
    if (serverVersion !== 'none') {
      const serverPath = await installServer(serverVersion, cliPath)
      core.addPath(serverPath)
    }

    core.addPath(cliPath)

    const instance = core.getInput('instance')
    const user = core.getInput('user')
    const password = core.getInput('password')
    const host = core.getInput('host')
    const port = core.getInput('port')
    const tlsCertData = core.getInput('tls-cert-data')
    const shouldLinkToProject = core.getBooleanInput('project-link')

    let tlsVerifyHostname = null
    if (core.getInput('tls-verify-hostname') !== '') {
      tlsVerifyHostname = core.getBooleanInput('tls-verify-hostname')
    } else if (tlsCertData !== '') {
      tlsVerifyHostname = true
    }

    let trustTlsCert = true
    if (core.getInput('trust-tls-cert') !== '') {
      trustTlsCert = core.getBooleanInput('trust-tls-cert')
    } else if (tlsCertData !== '') {
      trustTlsCert = false
    }

    if (instance !== '') {
      await createInstance(
        instance,
        user,
        password,
        host,
        port,
        tlsCertData,
        tlsVerifyHostname,
        trustTlsCert
      )

      if (shouldLinkToProject) {
        await linkInstanceWithProject(instance)
      }
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function installServer(
  requestedVersion: string,
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
  } else if (
    requestedVersion !== undefined &&
    requestedVersion !== '' &&
    requestedVersion !== 'stable'
  ) {
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

async function createInstance(
  instance: string,
  user: string,
  password: string,
  host: string,
  port: string,
  tlsCertData: string,
  tlsVerifyHostname: boolean | null,
  trustTlsCert: boolean
): Promise<void> {
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

  const baseOptionsLine = ['--user', user, '--host', host, '--port', port]

  if (password !== '') {
    options['input'] = Buffer.from(password)
    baseOptionsLine.push('--password-from-stdin')
  }

  if (tlsCertData !== '') {
    const certPath = saveCertData(tlsCertData)
    baseOptionsLine.push('--tls-ca-file', certPath)
  }

  switch (tlsVerifyHostname) {
    case null:
      break

    case true:
      baseOptionsLine.push('--tls-verify-hostname')
      break

    case false:
      baseOptionsLine.push('--no-tls-verify-hostname')
      break
  }

  const cmdOptionsLine = []
  if (trustTlsCert) {
    cmdOptionsLine.push('--trust-tls-cert')
  }

  const cmdLine = ['instance', 'link', '--non-interactive', instance]
    .concat(cmdOptionsLine)
    .concat(baseOptionsLine)
  const cli = 'edgedb'

  core.debug(`Running ${cli} ${cmdLine.join(' ')}`)
  await exec.exec(cli, cmdLine, options)
}

async function linkInstanceWithProject(instance: string): Promise<void> {
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

  const cmdLine = [
    'project',
    'init',
    '--non-interactive',
    '--link',
    '--server-instance',
    instance
  ]
  const cli = 'edgedb'

  core.debug(`Running ${cli} ${cmdLine.join(' ')}`)
  await exec.exec(cli, cmdLine, options)
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

function saveCertData(certData: string): string {
  const tmpdir = fs.mkdtempSync('setup-edgedb')
  const certPath = path.join(tmpdir, 'cert.pem')
  fs.writeFileSync(certPath, certData)
  return certPath
}
