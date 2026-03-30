import * as React from "react";
import { Section, Text } from "@react-email/components";

import { baseStyles } from "./base-styles";

export function EmailHeader() {
  return (
    <Section style={baseStyles.header}>
      <table role="presentation" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td style={{ padding: 0, verticalAlign: "middle" }}>
              <span style={{ ...baseStyles.brandName, display: "inline-block", margin: 0 }}>
                TradingGoose
              </span>
              <Text style={baseStyles.tagline}>Market Data Platform</Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export default EmailHeader;
