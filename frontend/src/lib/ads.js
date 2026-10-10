/* AdSense configuration for the landing page.
 *
 * The client (publisher) ID is public and matches the loader in
 * public/index.html. The per-unit slot IDs are only known once an ad unit has
 * been created in the AdSense dashboard: Ads > By site > + New ad unit.
 *
 * Each slot is supplied through an environment variable so a deployment can
 * switch units on without a code change. A blank slot means "no unit here" and
 * AdSlot renders nothing at all, so an unconfigured build never reserves empty
 * space or asks Google for a slot that does not exist.
 */

export const ADSENSE_CLIENT = "ca-pub-3056395143178832";
// Advertising is explicitly opt-in at deployment as well as per visitor.
export const ADS_ENABLED = process.env.REACT_APP_ENABLE_ADS === "true";

const slot = (name) => {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
};

export const AD_SLOTS = {
  // Between the product tour and the feature list: the visitor has just seen
  // the desk working, so an in-content unit reads as the next thing to look at
  // rather than an interruption.
  afterDemo: slot("REACT_APP_ADSENSE_SLOT_DEMO"),

  // Between "how it works" and the setup guide, for readers who made it
  // through the explanation but are not ready to open the desk yet.
  afterHow: slot("REACT_APP_ADSENSE_SLOT_HOW"),
};
