import { Server } from "lucide-react";

import { MarketAccountPreview } from "./market-account-preview";
import { MarketFeatureTextCard } from "./market-feature-text-card";
import styles from "./market-access-feature.module.css";

export function MarketAccessFeature() {
  return (
    <section
      id="access-and-usage"
      aria-labelledby="access-heading"
      className={styles.feature}
    >
      <MarketFeatureTextCard
        className={styles.copy}
        headingId="access-heading"
        label="API access"
        icon={<Server className="size-5" />}
        title={<>Your keys. Your usage.<br />Your infrastructure.</>}
        description="Manage API keys for your applications and review requests by key, app, or endpoint."
        bullets={[
          "Set optional limits on each key’s API charges.",
          "Open source. Deploy on your own infrastructure.",
          "Manage reference data in your self-hosted instance.",
        ]}
      />

      <MarketAccountPreview className={styles.preview} />
    </section>
  );
}
