import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Text
} from "@react-email/components";

import { baseStyles } from "./base-styles";
import { EmailFooter } from "./footer";
import { EmailHeader } from "./header";

interface InvitationEmailProps {
  inviterName?: string;
  invitedEmail?: string;
  role?: string;
  inviteLink?: string;
  expiresInDays?: number;
}

export function InvitationEmail({
  inviterName = "An administrator",
  invitedEmail = "",
  role = "viewer",
  inviteLink = "",
  expiresInDays = 7
}: InvitationEmailProps) {
  const preview = `${inviterName} invited you to join TradingGoose Market`;

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{preview}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;ve been invited!</Text>
            <Text style={baseStyles.paragraph}>
              <strong>{inviterName}</strong> has invited you to join{" "}
              <strong>TradingGoose Market</strong> as{" "}
              <span style={baseStyles.badge}>{role}</span>.
            </Text>
            <Text style={baseStyles.paragraph}>
              Click the button below to create your account and get started.
            </Text>

            <Section>
              <table role="presentation" width="100%">
                <tbody>
                  <tr>
                    <td align="center">
                      <Link href={inviteLink} style={{ textDecoration: "none" }}>
                        <Text
                          style={{
                            ...baseStyles.button,
                            display: "inline-block",
                            margin: "22px 0"
                          }}
                        >
                          Accept Invitation
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Section style={baseStyles.divider} />

            <Text
              style={{
                ...baseStyles.paragraph,
                fontSize: "14px",
                color: "#929eae",
                marginTop: "10px"
              }}
            >
              If you did not expect this invitation, please disregard this email.
              This invitation expires in {expiresInDays} days for security.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: "18px",
                fontFamily: baseStyles.fontFamily
              }}
            >
              Sent to {invitedEmail}.
            </Text>
          </Section>
        </Container>

        <EmailFooter />
      </Body>
    </Html>
  );
}

export default InvitationEmail;
