import type { PROJECT_TYPES } from "../../database/schema/projects.js";

export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Board columns every new project starts with (unchanged from the source app). */
export function defaultColumns(type: ProjectType): { name: string; isDone: boolean }[] {
  return type === "sprint"
    ? [
        { name: "Backlog", isDone: false },
        { name: "In Progress", isDone: false },
        { name: "Ready to Test", isDone: false },
        { name: "Ready to Deploy", isDone: false },
        { name: "Deployed", isDone: false },
        { name: "Complete", isDone: true },
      ]
    : [
        { name: "To Do", isDone: false },
        { name: "In Progress", isDone: false },
        { name: "In Review", isDone: false },
        { name: "Done", isDone: true },
      ];
}

/** Upper-case letters and digits only, 2–8 characters. */
export function normalizeProjectKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}
