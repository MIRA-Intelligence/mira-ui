import { t, type I18nKey } from '@/i18n'
import type { Language } from '@/stores/settingsStore'
import type { RemoteSshErrorCode, RemoteSshStatus } from '@/services/remoteSsh'

const ERROR_KEYS: Partial<Record<RemoteSshErrorCode, I18nKey>> = {
  invalid_host: 'sshErrorInvalidHost',
  invalid_command: 'sshErrorInvalidCommand',
  auth_required: 'sshErrorAuthRequired',
  host_key: 'sshErrorHostKey',
  ssh_failed: 'sshErrorSshFailed',
  not_installed: 'sshErrorNotInstalled',
  incompatible: 'sshErrorIncompatible',
  invalid_output: 'sshErrorInvalidOutput',
  tunnel_failed: 'sshErrorTunnel',
  unavailable: 'sshErrorUnavailable',
}

export function remoteSshMessage(status: RemoteSshStatus, lang: Language, fallbackHost = '', miraCommand = ''): string {
  const host = status.host || fallbackHost
  const command = miraCommand.trim() || 'mira'
  switch (status.phase) {
    case 'idle':
      return t('sshStatusIdle', lang)
    case 'connecting':
      return t('sshStatusConnecting', lang, { host })
    case 'connected':
      return t('sshStatusConnected', lang, { host, version: status.version ?? '?' })
    case 'reconnecting':
      return t('sshStatusReconnecting', lang, { host, attempt: status.attempt || 1 })
    case 'error': {
      const code = status.error?.code ?? 'internal'
      const detail = status.error?.message || code
      return t(ERROR_KEYS[code] ?? 'sshErrorEngine', lang, { host, detail, code, command })
    }
  }
}
