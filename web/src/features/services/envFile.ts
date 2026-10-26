/** base64 of "PRBENC1\n": every Probe .enc file starts with this. Mirrors ENC_BASE64_PREFIX on the server. */
const ENC_PREFIX = 'UFJCRU5DMQ';

/** True for a passphrase-protected file, by extension or by content (so a renamed file still works). */
export const looksEncrypted = (fileName: string, text: string): boolean => fileName.toLowerCase().endsWith('.enc') || text.trim().startsWith(ENC_PREFIX);

/** Save text as a file in the browser (used for the .enc export). */
export function downloadText(fileName: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** A file name that is safe on Windows and keeps Korean letters. */
export const safeFileName = (name: string): string => name.replace(/[^\w가-힣-]+/g, '_');
