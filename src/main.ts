// Boot: renderer and scenes, the core actions, then each layout region handed to its module.
// Nobody else edits this file or index.html: new UI goes into the module that owns a region.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';
import { analysis } from './core/analysisStore';
import * as actions from './core/actions';
import { createCoreActions } from './core/coreActions';
import { createPresetActions } from './core/presetActions';
import { createDecisionActions } from './core/decisionActions';
import { applyDeepLink, parseDeepLink, syncUrl } from './core/deepLink';
import { missionFilter } from './core/missionFilter';
import { DEFAULT_SELECTED_POINT, store } from './core/store';
import { getLandings, setLandings } from './data/catalog';
import { loadLandings } from './data/landings';
import { getPresets, loadPresets, setPresets } from './data/presets';
import { displaySummary } from './scene/globe/displayState';
import { SceneHost } from './scene/globe/sceneHost';
import { mountAssistantButton, mountAssistantDrawer } from './ui/assistant/drawer';
import { mountComparePanel } from './ui/compare/panel';
import { mountFiltersPanel } from './ui/globe/filtersPanel';
import { panelSummary } from './ui/globe/panels';
import { mountSiteCard } from './ui/globe/siteCard';
import { registerSiteScienceActions } from './ui/science/siteScience';
import { mountCloseButton } from './ui/shared/closeButton';
import { mountCompass } from './ui/shared/compass';
import { locatorZoom, mountLocatorMap } from './ui/shared/locatorMap';
import { mountTimeScrubber } from './ui/shared/timeScrubber';
import { mountToasts } from './ui/shared/toast';
import { mountSurfaceHud } from './ui/surface/hud';
import { mountKeyMetrics } from './ui/surface/metrics';
import { mountSkylineChart } from './ui/surface/skylineChart';
import { mountSurfacePanels } from './ui/surface/panels';
import { mountIntro } from './ui/intro/intro';
import { setPhase, shouldShowIntro } from './ui/intro/phase';

const region = (name: string) => document.getElementById(`region-${name}`) as HTMLElement;

async function boot() {
  const host = new SceneHost(document.getElementById('scene') as HTMLCanvasElement);
  // The catalogue is needed to start; the mission presets are an extra and may fail without stopping the app.
  const [landings, presets] = await Promise.all([loadLandings(), loadPresets().then((list) => ({ list, why: null as string | null }), (err) => ({ list: [], why: err instanceof Error ? err.message : String(err) }))]);
  setLandings(landings);
  setPresets(presets.list, presets.why);
  if (presets.why) console.warn('Mission presets:', presets.why);
  actions.registerActions(
    createCoreActions({
      store,
      landings: getLandings,
      filters: missionFilter,
      analysis,
      prepareSurface: host.prepareSurface,
      viewShown: host.viewShown,
      display: displaySummary,
      shell: () => ({ locatorZoom: locatorZoom(), panels: panelSummary() }),
    }),
  );
  registerSiteScienceActions(); // getSiteScience, nearestIceTargets (the site card's science section shows the same readouts)
  actions.registerActions(createPresetActions({ store, presets: getPresets, landings: getLandings, analysis, prepareSurface: host.prepareSurface, viewShown: host.viewShown }));
  // The decision engine's tools (D-17): profiles, settings, evaluateSite, compareSites, findBestSites.
  actions.registerActions(createDecisionActions({ store, landings: getLandings }));
  // Expose the registry for the assistant's tests and for debugging in the console.
  (window as unknown as { lunyx: unknown }).lunyx = { store, analysis, actions, scene: host };

  mountToasts(region('toast'));
  mountFiltersPanel(region('left'));
  mountSiteCard(region('card'));
  mountCompass(region('compass'), () => host.globe.northAngleDeg(), (fn) => host.onFrame(fn));
  mountTimeScrubber(region('scrubber'));
  mountLocatorMap(region('locator'), host.surface.view, (fn) => host.onFrame(fn));
  mountKeyMetrics(region('metrics'));
  mountSkylineChart(region('chart'));
  mountCloseButton(region('close'));
  mountSurfaceHud(region('surface-hud'), host.surface, (fn) => host.onFrame(fn));
  mountComparePanel(region('compare'));
  mountAssistantButton(region('assistant'));
  mountAssistantDrawer(region('drawer'));
  mountSurfacePanels();

  const link = parseDeepLink(location.search);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const showIntro = shouldShowIntro(link, { reducedMotion, search: location.search });
  host.globe.setIntroPresentation(showIntro);
  setPhase(showIntro ? 'intro' : 'app');
  const intro = mountIntro(document.getElementById('region-intro') as HTMLElement, {
    reducedMotion,
    onEnter: () => {
      host.globe.revealIntroMarkers();
      // Keep the globe interactive once the HUD is back; scene was never restarted.
      host.globe.controls.enabled = store.get().view === 'globe';
    },
  });
  if (!showIntro) {
    host.globe.controls.enabled = store.get().view === 'globe';
  } else {
    host.globe.controls.enabled = false;
  }

  await host.load();
  void analysis.start();
  const errors = await applyDeepLink(link, host.jumpTo);
  for (const e of errors) console.warn('Deep link:', e);
  // Start at the south-pole pin unless the link already selected a site or preset.
  if (!store.get().site) {
    const point = DEFAULT_SELECTED_POINT;
    await actions.runAction('dropPin', point);
    host.globe.jumpTo(point.lat, point.lon, store.get().globeCenter.altitudeKm);
  }
  syncUrl(store);
  document.getElementById('loading')!.classList.add('done');
  if (showIntro) {
    // Focus the Enter control once the loading veil is gone.
    requestAnimationFrame(() => intro.enter.focus({ preventScroll: true }));
  }
}

boot().catch((err) => {
  console.error(err);
  setPhase('app');
  const shell = document.getElementById('shell');
  shell?.removeAttribute('inert');
  shell?.setAttribute('aria-hidden', 'false');
  document.getElementById('loading')!.textContent = 'Could not load the Moon. Run "npm run fetch-textures" and reload.';
});
