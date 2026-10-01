import type { ComponentType } from "react";

export type TemplateEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  subject: string | ((data: Record<string, unknown>) => string);
  displayName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previewData?: Record<string, any>;
  /** Fixed recipient that overrides the caller's recipient. */
  to?: string;
};
