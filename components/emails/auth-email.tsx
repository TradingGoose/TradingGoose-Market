import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type MarketAuthEmailKind =
  | "sign-in-otp"
  | "password-reset"
  | "email-change-verification";

const copy = {
  "sign-in-otp": {
    preview: "Your TradingGoose Market verification code",
    title: "Verify your email",
    introduction: "Use this code to finish signing in to TradingGoose Market.",
  },
  "password-reset": {
    preview: "Reset your TradingGoose Market password",
    title: "Reset your password",
    introduction: "A password reset was requested for your TradingGoose Market account.",
  },
  "email-change-verification": {
    preview: "Verify your new TradingGoose Market email",
    title: "Verify your new email",
    introduction: "Confirm this address to finish changing your TradingGoose Market email.",
  },
} as const;

export function MarketAuthEmail({ kind, otp, url }: {
  kind: MarketAuthEmailKind;
  otp?: string;
  url?: string;
}) {
  const message = copy[kind];
  return (
    <Html lang="en">
      <Head />
      <Preview>{message.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>TRADINGGOOSE MARKET</Text>
          <Heading style={heading}>{message.title}</Heading>
          <Text style={paragraph}>{message.introduction}</Text>
          {otp ? (
            <Section style={codePanel}>
              <Text style={code}>{otp}</Text>
            </Section>
          ) : null}
          {url ? (
            <Section style={actionPanel}>
              <Button href={url} style={button}>Continue securely</Button>
            </Section>
          ) : null}
          <Text style={paragraph}>
            {otp
              ? "This code expires in 15 minutes. If you did not request it, you can ignore this email."
              : "If you did not request this change, you can ignore this email."}
          </Text>
          {url ? <Text style={fallback}>If the button does not work, paste this address into your browser: {url}</Text> : null}
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#f4f4f5", fontFamily: "Arial, sans-serif", margin: 0, padding: "32px 12px" };
const container = { backgroundColor: "#ffffff", border: "1px solid #e4e4e7", borderRadius: "12px", margin: "0 auto", maxWidth: "560px", padding: "36px" };
const brand = { color: "#71717a", fontSize: "12px", fontWeight: "700", letterSpacing: "0.14em", margin: "0 0 20px" };
const heading = { color: "#18181b", fontSize: "28px", lineHeight: "36px", margin: "0 0 16px" };
const paragraph = { color: "#3f3f46", fontSize: "16px", lineHeight: "25px", margin: "16px 0" };
const codePanel = { backgroundColor: "#18181b", borderRadius: "10px", margin: "28px 0", padding: "18px" };
const code = { color: "#ffffff", fontFamily: "monospace", fontSize: "32px", fontWeight: "700", letterSpacing: "0.28em", margin: 0, textAlign: "center" as const };
const actionPanel = { margin: "28px 0" };
const button = { backgroundColor: "#18181b", borderRadius: "8px", color: "#ffffff", display: "inline-block", fontSize: "15px", fontWeight: "700", padding: "13px 20px", textDecoration: "none" };
const fallback = { color: "#71717a", fontSize: "12px", lineHeight: "18px", margin: "24px 0 0", overflowWrap: "anywhere" as const };
