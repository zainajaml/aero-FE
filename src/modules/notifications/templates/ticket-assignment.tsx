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

interface TicketAssignmentEmailProps {
  recipientName?: string | null;
  actorName?: string | null;
  ticketTitle?: string | null;
  ticketCode?: string | null;
  ticketUrl?: string;
}

function TicketAssignmentEmail({
  recipientName = null,
  actorName = "Someone",
  ticketTitle = "a ticket",
  ticketCode = null,
  ticketUrl = "https://spacescope.ai",
}: TicketAssignmentEmailProps) {
  const titleLine = ticketCode ? `${ticketCode} · ${ticketTitle}` : ticketTitle;
  return (
    <Html>
      <Head />
      <Preview>{`${actorName} assigned ${titleLine} to you`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brand}>Space Scope</Text>
          </Section>
          <Heading style={h1}>You were assigned a ticket</Heading>
          <Text style={text}>{recipientName ? `Hi ${recipientName},` : "Hi,"}</Text>
          <Text style={text}>
            <strong>{actorName}</strong> assigned <strong>{titleLine}</strong> to you.
          </Text>
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Button style={button} href={ticketUrl}>
              View ticket
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You received this because you were assigned a ticket you have access to in Space Scope.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const template = {
  component: TicketAssignmentEmail,
  subject: (data: Record<string, unknown>) => {
    const actor = (data.actorName as string) || "Someone";
    const code = data.ticketCode as string | undefined;
    const title = (data.ticketTitle as string) || "a ticket";
    const label = code ? `${code} · ${title}` : title;
    return `${actor} assigned ${label} to you`;
  },
  displayName: "Ticket assignment notification",
  previewData: {
    recipientName: "Jane",
    actorName: "Alex Rivera",
    ticketTitle: "Fix the onboarding flow",
    ticketCode: "SS-123",
    ticketUrl: "https://spacescope.ai/ticket/123",
  },
} satisfies TemplateEntry;

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
