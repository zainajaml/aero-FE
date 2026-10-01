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

interface SupportAdminAlertEmailProps {
  kind?: "new_ticket" | "new_message";
  subject?: string;
  ticketNumber?: string;
  requesterName?: string;
  messagePreview?: string;
  supportUrl?: string;
}

function SupportAdminAlertEmail({
  kind = "new_ticket",
  subject = "a new support request",
  ticketNumber = "",
  requesterName = "A user",
  messagePreview = "",
  supportUrl = "https://example.com",
}: SupportAdminAlertEmailProps) {
  const headline = kind === "new_ticket" ? "New support ticket" : "New reply on support ticket";
  return (
    <Html>
      <Head />
      <Preview>{`${headline}: ${subject}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brand}>Space Scope</Text>
          </Section>
          <Heading style={h1}>{headline}</Heading>
          <Text style={text}>
            {requesterName} {kind === "new_ticket" ? "opened" : "added a message to"}{" "}
            <strong>{subject}</strong>
            {ticketNumber ? ` (${ticketNumber})` : ""}.
          </Text>
          {messagePreview ? (
            <Section style={quote}>
              <Text style={quoteText}>{messagePreview}</Text>
            </Section>
          ) : null}
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Button style={button} href={supportUrl}>
              Open ticket
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You're receiving this because you're a Super Admin on Space Scope.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = { backgroundColor: "#0b0b12", fontFamily: "system-ui, sans-serif" };
const container = { margin: "0 auto", padding: "32px 24px", maxWidth: "480px" };
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
const quote = {
  backgroundColor: "#15151f",
  borderLeft: "3px solid #7c3aed",
  borderRadius: "8px",
  margin: "16px 0",
  padding: "12px 16px",
};
const quoteText = { color: "#c4c4d0", fontSize: "14px", lineHeight: "22px", margin: 0 };
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
  component: SupportAdminAlertEmail,
  subject: (data: Record<string, unknown>) => {
    const label = data?.kind === "new_message" ? "New reply" : "New ticket";
    const suffix = data?.ticketNumber ? ` [${data.ticketNumber}]` : "";
    return data?.subject
      ? `${label}${suffix}: ${data.subject} · Space Scope Support`
      : `${label}${suffix} · Space Scope Support`;
  },
  displayName: "Support Admin Alert",
  previewData: {
    kind: "new_ticket",
    subject: "Cannot upload attachments",
    ticketNumber: "A1B2C3",
    requesterName: "Jordan Rivera",
    messagePreview: "Trying to attach a screenshot but it fails at 80%.",
    supportUrl: "https://example.com",
  },
} satisfies TemplateEntry;
