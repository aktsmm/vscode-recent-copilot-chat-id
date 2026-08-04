export interface CopySessionPort {
  writeText(value: string): PromiseLike<void>;
  showSuccess(shortId: string): void;
  showFailure(error: unknown): PromiseLike<boolean>;
  showLog(): void;
}

export async function copySessionIdWithRecovery(
  id: string,
  port: CopySessionPort,
): Promise<void> {
  try {
    await port.writeText(id);
    port.showSuccess(id.slice(0, 8));
  } catch (error) {
    if (await port.showFailure(error)) {
      port.showLog();
    }
  }
}
