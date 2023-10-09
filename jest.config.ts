import type {Config} from '@jest/types'

// eslint-disable-next-line import/no-anonymous-default-export
export default async (): Promise<Config.InitialOptions> => ({
  clearMocks: true,
  preset: 'ts-jest/presets/default-esm-legacy',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  verbose: true
})
