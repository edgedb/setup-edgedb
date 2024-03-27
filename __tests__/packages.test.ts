import {expect, describe, it, beforeAll} from '@jest/globals'
import type * as packagesType from '../src/packages'
import type * as fetchType from 'node-fetch'
import {SpiedModule, spyOnModule} from './spy-on-module'

const fakeIndex: packagesType.PackageIndex = [
  {name: 'edgedb-cli', version: '1.0.0+5724c50', revision: '202202100030'},
  {name: 'edgedb-cli', version: '1.0.0-rc.2+eea8ba1', revision: '202111111827'},
  {name: 'edgedb-cli', version: '1.0.0-rc.3+b13dfe9', revision: '202111301914'},
  {name: 'edgedb-cli', version: '1.0.0-rc.6+5626317', revision: '202201191751'},
  {name: 'edgedb-cli', version: '1.1.0+96c3d69', revision: '202202222341'},
  {name: 'edgedb-cli', version: '1.1.1+5bb8bad', revision: '202203171920'},
  {name: 'edgedb-cli', version: '1.1.2+58eb29e', revision: '202204240642'},
  {name: 'edgedb-cli', version: '1.2.0+cc78a3d', revision: '202207132102'},
  {name: 'edgedb-cli', version: '1.2.1+7ae7e10', revision: '202207142033'},
  {name: 'edgedb-cli', version: '1.2.2+2874715', revision: '202207191809'},
  {name: 'edgedb-cli', version: '1.2.3+d637394', revision: '202207251735'},
  {name: 'edgedb-cli', version: '2.0.0+62ada3f', revision: '202207272022'},
  {name: 'edgedb-cli', version: '2.3.1+ef99779', revision: '202302211915'},
  {name: 'edgedb-cli', version: '3.0.0+8b024db', revision: '202305171711'},
  {name: 'edgedb-cli', version: '3.4.0+160d07d', revision: '202307070213'},
  {name: 'edgedb-cli', version: '3.5.0+907ff37', revision: '202309122051'},
  {name: 'edgedb-server-3', version: '3.3+8d42667', revision: '202309062039'},
  {name: 'edgedb-server-3', version: '3.4+4fc6d86', revision: '202309271921'}
].map((init): packagesType.Package => {
  const installRef = `/archive/x86_64-unknown-linux-musl/${init.name}-${init.version}`
  return {
    ...init,
    architecture: 'x86_64' as const,
    installref: installRef,
    downloadUrl: installRef
  }
})

describe('packages', () => {
  let src: SpiedModule<typeof packagesType>
  let fetch: SpiedModule<typeof fetchType>
  beforeAll(async () => {
    fetch = await spyOnModule<typeof fetchType>('node-fetch')
    src = await spyOnModule<typeof packagesType>('../src/packages')
  })

  it('Finds best package correctly', async () => {
    let pkg = src.findBestPackage(fakeIndex, 'edgedb-cli', '1.0.0-rc.2')
    expect(pkg?.version).toBe('1.0.0-rc.2+eea8ba1')

    pkg = src.findBestPackage(fakeIndex, 'edgedb-cli', '*')
    expect(pkg?.version).toBe('3.5.0+907ff37')

    pkg = src.findBestPackage(fakeIndex, 'edgedb-server-3', '*')
    expect(pkg?.version).toBe('3.4+4fc6d86')

    pkg = src.findBestPackage(fakeIndex, 'edgedb-cli', '>=3.2.0 <=3.4.0')
    expect(pkg?.version).toBe('3.4.0+160d07d')

    pkg = src.findBestPackage(fakeIndex, 'edgedb-cli', '^1')
    expect(pkg?.version).toBe('1.2.3+d637394')
  })

  it('Fetches package index', async () => {
    const apiResult = [
      {
        name: 'edgedb-cli',
        version: '3.5.0+907ff37',
        revision: '202309122051',
        installref: '/path'
      },
      {
        name: 'edgedb-cli',
        version: '3.5.0+907ff37',
        revision: '202309122053',
        installref: '/path'
      },
      {
        name: 'edgedb-server-3',
        version: '3.3+8d42667',
        revision: '202309062050',
        installref: '/path'
      },
      {
        name: 'edgedb-server-3',
        version: '3.3+8d42667',
        revision: '202309062039',
        installref: '/path'
      }
    ]
    fetch.default.mockResolvedValue({
      json: async () => ({packages: apiResult})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const packages = await src.getPackageIndex()

    expect(fetch.default).toHaveBeenCalled()
    expect(new URL(fetch.default.mock.calls[0][0] as string)).toBeInstanceOf(
      URL
    )

    // De-dupes revisions correctly
    expect(packages).toHaveLength(2)
    expect(packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'edgedb-cli',
          version: '3.5.0+907ff37',
          revision: '202309122053'
        }),
        expect.objectContaining({
          name: 'edgedb-server-3',
          version: '3.3+8d42667',
          revision: '202309062050'
        })
      ])
    )

    // Has valid download URL
    expect(new URL(packages[0].downloadUrl)).toBeInstanceOf(URL)
    expect(packages[0].downloadUrl.endsWith('/path')).toBe(true)
  })
})
