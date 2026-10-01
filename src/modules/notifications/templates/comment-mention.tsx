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

interface CommentMentionEmailProps {
  recipientName?: string | null;
  actorName?: string | null;
  ticketTitle?: string | null;
  ticketUrl?: string;
  commentPreview?: string | null;
  /** True when the email is about a reply to the recipient's comment. */
  replyToComment?: boolean;
}

function CommentMentionEmail({
  recipientName = null,
  actorName = "Someone",
  ticketTitle = "a ticket",
  ticketUrl = "https://spacescope.ai",
  commentPreview = null,
  replyToComment = false,
}: CommentMentionEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${actorName} ${replyToComment ? "replied to your comment on" : "mentioned you on"} ${ticketTitle}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brand}>Space Scope</Text>
          </Section>
          <Heading style={h1}>
            {replyToComment ? "New reply to your comment" : "You were mentioned"}
          </Heading>
          <Text style={text}>{recipientName ? `Hi ${recipientName},` : "Hi,"}</Text>
          <Text style={text}>
            <strong>{actorName}</strong>{" "}
            {replyToComment ? "replied to your comment on" : "mentioned you in a comment on"}{" "}
            <strong>{ticketTitle}</strong>.
          </Text>
          {commentPreview ? (
            <Section style={quote}>
              <Text style={quoteText}>{commentPreview}</Text>
            </Section>
          ) : null}
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Button style={button} href={ticketUrl}>
              View comment
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You received this because you were {replyToComment ? "part of a" : "tagged in a"}{" "}
            conversation on a ticket you have access to in Space Scope.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const template = {
  component: CommentMentionEmail,
  subject: (data: Record<string, unknown>) => {
    const actor = (data.actorName as string) || "Someone";
    const title = (data.ticketTitle as string) || "a ticket";
    if (data.replyToComment === true) {
      return `${actor} replied to your comment on ${title}`;
    }
    return `${actor} mentioned you on ${title}`;
  },
  displayName: "Comment mention notification",
  previewData: {
    recipientName: "Jane",
    actorName: "Alex Rivera",
    ticketTitle: "Fix the onboarding flow",
    ticketUrl: "https://spacescope.ai/ticket/123",
    commentPreview: "Hey @Jane can you take a look at this when you get a chance?",
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
const quote = {
  backgroundColor: "#16161f",
  borderLeft: "3px solid #7c3aed",
  borderRadius: "6px",
  padding: "12px 16px",
  margin: "8px 0 4px",
};
const quoteText = {
  color: "#c4c4d0",
  fontSize: "14px",
  lineHeight: "22px",
  margin: 0,
  whiteSpace: "pre-wrap" as const,
};
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
