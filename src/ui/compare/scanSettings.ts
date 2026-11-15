// What the Radius and Spacing fields of the "Nearby sites" tab show while the tab is drawn
// again (QA finding Q-7). Written against "a field that can be shown a number" rather than DOM
// types, so it is tested in node.

/** A scan setting field, as far as these rules need one: NumberField.show(), which leaves alone a field the person is typing in. */
export interface ScanSettingField {
  show(v: number): void;
}

/** The radius and spacing of a scan, metres. */
export interface ScanSettings {
  readonly radiusM: number;
  readonly spacingM: number;
}

/**
 * Where the fields' numbers come from: the panel state (the last scan's radius and spacing, the
 * defaults before any scan), and the scan the analysis store publishes now. Each scan is
 * published with its own options object (rankNearby builds one per scan, and the store keeps it
 * on the scan's loading, progress, ready and error states), so a new object means a new scan.
 */
export interface ScanSettingSources {
  panel: { get(): { readonly nearbyRadiusM: number; readonly nearbySpacingM: number } };
  analysis: { nearby(): { readonly options?: ScanSettings } };
}

/**
 * Fills the Radius and Spacing fields from the panel's settings, and returns what the tab calls
 * on every redraw: it puts a scan's radius and spacing in the fields once, at the first redraw
 * that sees the scan, and otherwise leaves the fields as they are.
 *
 * The tab is drawn again on many changes: a requirement (the slope limit, the Sun's band, the
 * Earth gap), the site or its mission window, the tab or the panel being shown, the panel's
 * settings, the scan's progress and result. Each of those used to put the last scan's settings
 * back over what had been typed, so that the next scan silently covered another area than the
 * fields said (Q-7). Now a typed radius or spacing, committed or still being typed, stays until
 * a new scan starts, by the panel or by the assistant; the fields then show what that scan
 * covers, except a field the person is typing in, which keeps the typing.
 */
export function bindScanSettings(radius: ScanSettingField, spacing: ScanSettingField, { panel, analysis }: ScanSettingSources): () => void {
  const p = panel.get();
  radius.show(p.nearbyRadiusM);
  spacing.show(p.nearbySpacingM);
  let shown = analysis.nearby().options;
  return () => {
    const scan = analysis.nearby().options;
    if (!scan || scan === shown) return;
    shown = scan;
    radius.show(scan.radiusM);
    spacing.show(scan.spacingM);
  };
}
