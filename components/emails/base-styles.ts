const primaryColor = "#22c55e";
const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const baseStyles = {
  fontFamily,
  main: {
    backgroundColor: "#0b0b0b",
    fontFamily,
    padding: "24px 0"
  },
  container: {
    maxWidth: "480px",
    width: "100%",
    margin: "0 auto",
    backgroundColor: "#1a1a1a",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
    border: "1px solid #2a2a2a",
    padding: "32px 28px 28px 28px"
  },
  header: {
    textAlign: "left" as const,
    paddingBottom: "8px"
  },
  brandName: {
    color: primaryColor,
    fontSize: "22px",
    fontWeight: 800,
    letterSpacing: "-0.01em"
  },
  tagline: {
    color: "#939eae",
    fontSize: "10px",
    fontWeight: 600,
    margin: "0",
    textAlign: "left" as const
  },
  content: {
    padding: "4px 0 0 0",
    textAlign: "left" as const
  },
  title: {
    fontSize: "22px",
    lineHeight: "1.4",
    color: "#e5e5e5",
    fontWeight: 600,
    margin: "12px 0",
    textAlign: "left" as const
  },
  paragraph: {
    fontSize: "15px",
    lineHeight: "1.6",
    color: "#c5cbd8",
    margin: "12px 0",
    textAlign: "left" as const
  },
  button: {
    display: "inline-block",
    backgroundColor: primaryColor,
    color: "#000000",
    fontWeight: 800,
    fontSize: "15px",
    padding: "12px 24px",
    borderRadius: "20px",
    textDecoration: "none",
    textAlign: "center" as const,
    margin: "22px auto"
  },
  link: {
    color: primaryColor,
    textDecoration: "underline"
  },
  footer: {
    maxWidth: "420px",
    margin: "12px auto 0 auto",
    padding: "12px 0",
    textAlign: "center" as const
  },
  footerText: {
    fontSize: "12px",
    color: "#7c8299",
    margin: "0",
    lineHeight: "1.5",
    textAlign: "center" as const
  },
  codeContainer: {
    margin: "16px 0",
    padding: "16px",
    backgroundColor: "#0f1014",
    borderRadius: "10px",
    border: "1px solid #2a2a2a",
    textAlign: "center" as const
  },
  code: {
    fontSize: "18px",
    fontWeight: 700,
    fontFamily: "monospace",
    color: primaryColor
  },
  divider: {
    borderTop: "1px solid #2a2a2a",
    margin: "18px 0"
  },
  badge: {
    display: "inline-block",
    backgroundColor: "#2a2a2a",
    color: "#e5e5e5",
    fontSize: "13px",
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: "6px"
  }
};
