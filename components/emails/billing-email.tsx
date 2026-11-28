import { Body, Button, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";
import { formatBillingUsd } from "@/lib/account/billing-presentation";

export type BillingEmailMessage =
  | { kind: "usage" | "upgrade"; name: string; url: string; unsubscribe: string; current: string; limit: string; percent: number }
  | { kind: "payment"; name: string; url: string; amount: number; lastFour?: string; reason?: string };

export const billingSubjects = {
  usage: "You're nearing your monthly budget on TradingGoose Market",
  upgrade: "Your current tier is nearing its included usage on TradingGoose Market",
  payment: "TradingGoose Market payment failed - action required",
};

export function BillingEmail({ message: m }: { message: BillingEmailMessage }) {
  const payment = m.kind === "payment";
  const title = payment ? "We were unable to process your payment." : m.kind === "usage"
    ? `You're at ${m.percent}% of your budget` : "Your included usage is almost used";
  const preview = payment ? billingSubjects.payment : m.kind === "usage"
    ? `TradingGoose Market: You're at ${m.percent}% of your PAYG monthly budget`
    : "TradingGoose Market: PAYG is nearing its included usage";
  return <Html lang="en"><Head /><Preview>{preview}</Preview>
    <Body style={{ fontFamily: "Arial, sans-serif", color: "#18181b" }}>
      <Container style={{ maxWidth: 560, padding: 28 }}>
        <Heading>{title}</Heading>
        {payment ? <>
          <Text>Hi {m.name || "there"},</Text>
          <Text>Your TradingGoose Market account has been temporarily blocked to prevent service interruptions and unexpected charges. To restore access, please pay all outstanding usage invoices.</Text>
          <Heading as="h2">Payment Details</Heading>
          <Text>Amount due: {formatBillingUsd(m.amount)}</Text>
          {m.lastFour && <Text>Payment method: **** {m.lastFour}</Text>}
          {m.reason && <Text>Reason: {m.reason}</Text>}
        </> : m.kind === "usage" ? <>
          <Text>{m.name && `${m.name}, `}your PAYG tier usage is nearing the monthly limit.</Text>
          <Text>To avoid interruptions, consider increasing your monthly limit.</Text>
          <Text>{formatBillingUsd(m.current)} / {formatBillingUsd(m.limit)} used</Text>
          <Text>{m.percent}% of this month&apos;s budget</Text>
        </> : <>
          <Text>Hi {m.name || "there"},</Text>
          <Text>You&apos;ve used {formatBillingUsd(m.current)} of the {formatBillingUsd(m.limit)} included in PAYG ({m.percent}%).</Text>
        </>}
        <Button href={m.url} style={{ backgroundColor: "#18181b", color: "white", padding: "12px 18px", borderRadius: 6 }}>
          {payment ? "Pay Invoice" : m.kind === "usage" ? "Review limits" : "Review Billing Tiers"}
        </Button>
        {payment ? (
          <Text>Common reasons for payment failures include expired cards, insufficient funds, or incorrect billing information. If you continue to experience issues, contact support.</Text>
        ) : <>
          <Text>{m.kind === "usage" ? "We send this once when your usage reaches the configured billing warning threshold so you have time to adjust your tier or limit." : "This is a one-time notification after your default tier crosses its upgrade threshold."}</Text>
          <Link href={m.unsubscribe}>Unsubscribe</Link>
        </>}
      </Container>
    </Body></Html>;
}
