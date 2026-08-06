export interface CopySessionPort {
  writeText(value: string): PromiseLike<void>;
  showSuccess(shortId: string): void;
  showFailure(error: unknown): PromiseLike<boolean>;
  showLog(): void;
}

export function formatSessionClipboardText(id: string, title: string): string {
  const normalizedTitle = title.trim().replaceAll(/\s+/g, " ");
  return `${normalizedTitle}\nSession ID: ${id}`;
}

export async function copySessionWithTitleWithRecovery(
  id: string,
  title: string,
  port: CopySessionPort,
): Promise<void> {
  await copyTextWithRecovery(formatSessionClipboardText(id, title), id, port);
}

export async function copySessionIdWithRecovery(
  id: string,
  port: CopySessionPort,
): Promise<void> {
  await copyTextWithRecovery(id, id, port);
}

async function copyTextWithRecovery(
  value: string,
  id: string,
  port: CopySessionPort,
): Promise<void> {
  try {
    await port.writeText(value);
    port.showSuccess(id.slice(0, 8));
  } catch (error) {
    if (await port.showFailure(error)) {
      port.showLog();
    }
  }
}
