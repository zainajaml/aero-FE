/** Splits a display name into first/last parts, ignoring values that look like email addresses. */
export function splitFullName(fullName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first || first.includes("@")) return { firstName: null, lastName: null };
  return { firstName: first, lastName: parts.slice(1).join(" ") || null };
}

export function displayNameFromEmail(email: string): string {
  return email.split("@")[0] ?? email;
}
