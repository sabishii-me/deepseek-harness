#!/usr/bin/env bun
/** Development backend started by the Tauri supervisor. */
import { resolve } from 'node:path'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../cli/src/profile-boot.ts'

const root = resolve(import.meta.dirname, '../../..')
process.env.DSH_DESKTOP_BUN_COMPAT = '1'
await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'web',
  patchFiles: [resolve(root, 'apps/desktop/desktop-dev.patch.yml')],
  args: ['--host', '127.0.0.1', '--port', '0'],
  configReload: false,
})
