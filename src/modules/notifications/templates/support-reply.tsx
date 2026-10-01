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

interface SupportReplyEmailProps {
  subject?: string;
  replyPreview?: string;
  supportUrl?: string;
  recipientName?: string | null;
}

function SupportReplyEmail({
  subject = "your support request",
  replyPreview = "",
  supportUrl = "https://example.com",
  recipientName = null,
}: SupportReplyEmailProps) {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi there,";
  return (
    <Html>
      <Head />
      <Preview>New reply to your support request</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brand}>Space Scope</Text>
          </Section>
          <Heading style={h1}>You have a new reply</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            Our support team replied to your request <strong>{subject}</strong>.
          </Text>
          {replyPreview ? (
            <Section style={quote}>
              <Text style={quoteText}>{replyPreview}</Text>
            </Section>
          ) : null}
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Button style={button} href={supportUrl}>
              View conversation
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You're receiving this because you opened a support request on Space Scope.
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
  component: SupportReplyEmail,
  subject: (data: Record<string, unknown>) =>
    data?.subject
      ? `New reply to "${data.subject}" · Space Scope Support`
      : `New reply to your support request · Space Scope`,
  displayName: "Support Reply Notification",
  previewData: {
    subject: "Cannot upload attachments",
    replyPreview: "Thanks for reaching out — we've pushed a fix. Could you try again?",
    supportUrl: "https://example.com",
    recipientName: "Jordan",
  },
} satisfies TemplateEntry;
