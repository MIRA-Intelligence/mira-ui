import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

// The engine writes its gateway token here (mode 0600) when the gateway starts;
// see MIRA-Intelligence/mira#149. The renderer receives it only over IPC.
export const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{16,512}$/

export function gatewayTokenPath(miraHome: string): string {
  return path.join(miraHome, 'runtime', 'gateway-token')
}

export async function readGatewayToken(miraHome: string): Promise<string | null> {
  try {
    const token = (await readFile(gatewayTokenPath(miraHome), 'utf8')).trim()
    return TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  }
}

// Secrets go only to the main window's top-level frame, never to subframes
// (e.g. previewed artifacts) or other windows.
export function isMainFrameSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, main: WebContents | null | undefined): boolean {
  return Boolean(main) && event.sender === main && event.senderFrame === event.sender.mainFrame
}
