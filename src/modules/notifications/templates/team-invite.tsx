import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./template-entry.js";

interface InviteEmailProps {
  inviteUrl?: string;
  roleLabel?: string;
  projectName?: string | null;
  invitedByName?: string | null;
}

const ROLE_FALLBACK = "team member";

function InviteEmail({
  inviteUrl = "https://example.com/login",
  roleLabel = ROLE_FALLBACK,
  projectName = null,
  invitedByName = null,
}: InviteEmailProps) {
  const inviter = invitedByName ? <strong>{invitedByName}</strong> : "Someone";
  return (
    <Html>
      <Head />
      <Preview>
        {invitedByName || "Someone"} invited you to join the {projectName || "SpaceScope"} project
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brand}>Space Scope</Text>
          </Section>
          <Heading style={h1}>You're invited</Heading>
          <Text style={text}>
            {inviter} invited you to join the <strong>{projectName || "SpaceScope"}</strong> project
            on SpaceScope.
          </Text>
          <Text style={text}>
            Role: <strong>{roleLabel}</strong>
          </Text>
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Button style={button} href={inviteUrl}>
              Accept invitation
            </Button>
          </Section>
          <Text style={muted}>
            If you don't have an account yet, you'll be asked to create one with this email address.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            If you weren't expecting this invitation, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = { backgroundColor: "#0b0b12", fontFamily: "system-ui, sans-serif" };
const container = {
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "480px",
};
const brandRow = { marginBottom: "24px" };
const brand = {
  color: "#a78bfa",
  fontSize: "18px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  margin: 0,
};
const h1 = { color: "#ffffff", fontSize: "26px", fontWeight: 700, margin: "0 0 16px" };
const text = { color: "#d4d4e0", fontSize: "15px", lineHeight: "24px", margin: "0 0 12px" };
const muted = { color: "#9ca3af", fontSize: "13px", lineHeight: "20px", margin: "8px 0 0" };
const button = {
  backgroundColor: "#7c3aed",
  borderRadius: "9999px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 28px",
  textDecoration: "none",
};
const hr = { borderColor: "#27272a", margin: "28px 0" };
const footer = { color: "#71717a", fontSize: "12px", lineHeight: "18px", margin: 0 };

export const template = {
  component: InviteEmail,
  subject: (data: Record<string, unknown>) =>
    data?.projectName
      ? `You're invited to ${data.projectName} on Space Scope`
      : `You're invited to Space Scope`,
  displayName: "Team Invitation",
  previewData: {
    inviteUrl: "https://example.com/login",
    roleLabel: "client developer",
    projectName: "Apollo Launch",
    invitedByName: "Jordan",
  },
} satisfies TemplateEntry;
