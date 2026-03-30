import * as React from "react";
import { Container, Section, Text } from "@react-email/components";

import { baseStyles } from "./base-styles";

interface EmailFooterProps {
  baseUrl?: string;
}

export function EmailFooter({ baseUrl }: EmailFooterProps) {
  return (
    <Container style={baseStyles.footer}>
      <Section style={{ padding: "0 0 8px 0" }}>
        <table style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td align="center" style={{ paddingTop: "12px" }}>
                <Text
                  style={{
                    ...baseStyles.footerText,
                    fontFamily: baseStyles.fontFamily
                  }}
                >
                  &copy; {new Date().getFullYear()} TradingGoose Market. All Rights Reserved.
                  {baseUrl && (
                    <>
                      <br />
                      <a
                        href={baseUrl}
                        style={{
                          color: baseStyles.link.color,
                          textDecoration: "underline",
                          fontWeight: 600,
                          fontFamily: baseStyles.fontFamily
                        }}
                        rel="noopener noreferrer"
                      >
                        {baseUrl}
                      </a>
                    </>
                  )}
                </Text>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    </Container>
  );
}

export default EmailFooter;
