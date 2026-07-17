import {
  apiEntryPoints,
  landingExternalLinks,
  landingProduct,
  structuredFeatureList
} from "./copy";
import { getLandingSiteBaseUrl } from "../site-url";

export function StructuredData() {
  const siteBaseUrl = getLandingSiteBaseUrl();
  const entryPoint = apiEntryPoints.map((example) => ({
    "@type": "EntryPoint",
    httpMethod: example.method,
    urlTemplate: `${siteBaseUrl}${example.urlTemplate}`
  }));

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteBaseUrl}/#organization`,
        name: "TradingGoose",
        alternateName: ["TradingGoose Market", "TradingGoose.ai"],
        url: siteBaseUrl,
        sameAs: [
          landingExternalLinks.studioSite,
          landingExternalLinks.marketGitHub,
          landingExternalLinks.discord,
          landingExternalLinks.marketBlog
        ],
        description:
          "TradingGoose builds self-hostable trading software and canonical market reference data tools."
      },
      {
        "@type": "WebSite",
        "@id": `${siteBaseUrl}/#website`,
        url: siteBaseUrl,
        name: landingProduct.brand,
        description: landingProduct.description,
        publisher: { "@id": `${siteBaseUrl}/#organization` }
      },
      {
        "@type": "WebPage",
        "@id": `${siteBaseUrl}/#webpage`,
        url: siteBaseUrl,
        name: landingProduct.brand,
        description: landingProduct.description,
        isPartOf: { "@id": `${siteBaseUrl}/#website` },
        about: [
          { "@id": `${siteBaseUrl}/#software` },
          { "@id": `${siteBaseUrl}/#api` }
        ],
        breadcrumb: { "@id": `${siteBaseUrl}/#breadcrumb` }
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${siteBaseUrl}/#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: landingProduct.brand,
            item: siteBaseUrl
          }
        ]
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteBaseUrl}/#software`,
        name: landingProduct.brand,
        applicationCategory: "FinanceApplication",
        applicationSubCategory: "Market Reference Data Platform",
        operatingSystem: "Web",
        featureList: [...structuredFeatureList]
      },
      {
        "@type": "WebAPI",
        "@id": `${siteBaseUrl}/#api`,
        name: "TradingGoose Market API",
        description:
          "Versioned API for canonical market reference data used by TradingGoose clients.",
        documentation:
          "https://github.com/TradingGoose/TradingGoose-Market#readme",
        entryPoint
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, "\\u003c")
      }}
    />
  );
}
