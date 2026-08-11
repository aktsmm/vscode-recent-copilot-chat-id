export interface EnableAllPort {
  /** Resolves true only when the user accepts the combined disclosure. */
  confirm(): Promise<boolean>;
  enable(setting: string): Promise<void>;
}

/** Applies nothing unless the disclosure is accepted, so consent stays the gate. */
export async function enableAllLocalFeatures(
  settings: readonly string[],
  port: EnableAllPort,
): Promise<boolean> {
  if (!(await port.confirm())) {
    return false;
  }
  for (const setting of settings) {
    await port.enable(setting);
  }
  return true;
}
