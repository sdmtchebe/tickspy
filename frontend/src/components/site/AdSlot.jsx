import { useEffect, useRef, useSyncExternalStore } from "react";
import { ADSENSE_CLIENT, ADS_ENABLED } from "@/lib/ads";
import { getAdsConsent, subscribeAdsConsent } from "@/lib/privacy";

/* One responsive AdSense unit.
 *
 * Google's runtime queues pushes made before the script finishes loading, so
 * there is no need to await it. What does need care is React.StrictMode:
 * development mounts every component twice, and pushing the same <ins> twice
 * requests a second impression for one element. The module-level Set keys off
 * the slot, which survives the simulated remount, so each unit is queued once.
 *
 * `slot` comes from src/lib/ads.js. With no slot configured the component
 * renders nothing — no wrapper, no reserved height — so the page layout is
 * identical on a build where ads are switched off.
 */

const queued = new Set();

export const AdSlot = ({ slot, className = "" }) => {
  const ref = useRef(null);
  const consent = useSyncExternalStore(subscribeAdsConsent, getAdsConsent, () => "unknown");

  useEffect(() => {
    if (!ADS_ENABLED || !slot || consent !== "accepted") return;
    const el = ref.current;
    if (!el || queued.has(slot)) return;
    queued.add(slot);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }, [consent, slot]);

  if (!ADS_ENABLED || !slot || consent !== "accepted") return null;

  return (
    <div className={`relative z-10 ${className}`} data-testid={`ad-slot-${slot}`}>
      <div className="shell">
        <ins
          ref={ref}
          className="adsbygoogle"
          style={{ display: "block" }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </div>
  );
};
