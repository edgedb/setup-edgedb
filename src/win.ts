import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import {getCliPackage} from './packages'

export async function run(): Promise<void> {
  try {
    await installCLI()
    await installServer()
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

async function checkOutput(cmd: string, args?: string[]): Promise<string> {
  let out = ''

  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        out += data.toString()
      }
    }
  }

  await exec.exec(cmd, args, options)
  return out.trim()
}

async function installCLI(): Promise<void> {
  const requestedCLIVersion = core.getInput('cli-version')
  const pkg = await getCliPackage(requestedCLIVersion)
  core.info(
    `Downloading edgedb-cli ${pkg.version} - ${pkg.architecture} from ${pkg.downloadUrl}`
  )

  await checkOutput('wsl', [
    'curl',
    '--fail',
    '--output',
    '/usr/bin/edgedb',
    pkg.downloadUrl
  ])
  await checkOutput('wsl chmod +x /usr/bin/edgedb')
}

async function installServer(): Promise<void> {
  const requestedVersion = core.getInput('server-version')

  const args = []

  if (requestedVersion === 'nightly') {
    args.push('--nightly')
  } else if (requestedVersion !== '' && requestedVersion !== 'stable') {
    args.push('--version')
    args.push(requestedVersion)
  }

  await checkOutput('wsl', ['edgedb', 'server', 'install'].concat(args))

  if (args.length === 0) {
    args.push('--latest')
  }
  const bin = (
    await checkOutput(
      'wsl',
      ['edgedb', 'server', 'info', '--bin-path'].concat(args)
    )
  ).trim()

  if (bin === '') {
    throw Error('could not find edgedb-server bin')
  }

  const instDir = path.dirname(path.dirname(bin))

  await checkOutput('wsl', ['cp', '-a', instDir, '/opt/edgedb'])

  await checkOutput('wsl', [
    'ln',
    '-s',
    '/opt/edgedb/bin/edgedb-server',
    '/usr/bin/edgedb-server'
  ])
}
