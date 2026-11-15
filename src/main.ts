// Boot: renderer and scenes, the core actions, then each layout region handed to its module.
// Nobody else edits this file or index.html: new UI goes into the module that owns a region.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';
import { analysis } from './core/analysisStore';
import * as actions from './core/actions';
import { createCoreActions } from './core/coreActions';
import { applyDeepLink, parseDeepLink, syncUrl } from './core/deepLink';
import { missionFilter } from './core/missionFilter';
import { store } from './core/store';
import { getLandings, setLandings } from './data/catalog';
import { loadLandings } from './data/landings';
import { displaySummary } from './scene/globe/displayState';
import { SceneHost } from './scene/globe/sceneHost';
import { mountAssistantButton, mountAssistantDrawer } from './ui/assistant/drawer';
import { mountComparePanel } from './ui/compare/panel';
import { mountFiltersPanel } from './ui/globe/filtersPanel';
import { mountPerson } from './ui/globe/person';
import { mountReliefChip } from './ui/globe/reliefChip';
import { mountSiteCard } from './ui/globe/siteCard';
import { registerSiteScienceActions } from './ui/science/siteScience';
import { mountCloseButton } from './ui/shared/closeButton';
import { mountCompass } from './ui/shared/compass';
import { mountLocatorMap } from './ui/shared/locatorMap';
import { mountTimeScrubber } from './ui/shared/timeScrubber';
import { mountToasts } from './ui/shared/toast';
import { mountSurfaceHud } from './ui/surface/hud';
import { mountKeyMetrics } from './ui/surface/metrics';
import { mountSkylineChart } from './ui/surface/skylineChart';

const region = (name: string) => document.getElementById(`region-${name}`) as HTMLElement;

async function boot() {
  const host = new SceneHost(document.getElementById('scene') as HTMLCanvasElement);
  setLandings(await loadLandings());
  actions.registerActions(createCoreActions({ store, landings: getLandings, filters: missionFilter, analysis, prepareSurface: host.prepareSurface, display: displaySummary }));
  registerSiteScienceActions(); // getSiteScience, nearestIceTargets (the site card's science section shows the same readouts)
  // Expose the registry for the assistant's tests and for debugging in the console.
  (window as unknown as { lunyx: unknown }).lunyx = { store, analysis, actions, scene: host };

  mountToasts(region('toast'));
  mountFiltersPanel(region('left'));
  mountSiteCard(region('card'));
  mountCompass(region('compass'), () => host.globe.northAngleDeg(), (fn) => host.onFrame(fn));
  mountReliefChip(region('compass'));
  mountPerson(region('person'), (x, y) => host.globe.latLonAt(x, y));
  mountTimeScrubber(region('scrubber'));
  mountLocatorMap(region('locator'));
  mountKeyMetrics(region('metrics'));
  mountSkylineChart(region('chart'));
  mountCloseButton(region('close'));
  mountSurfaceHud(region('surface-hud'), host.surface, (fn) => host.onFrame(fn));
  mountComparePanel(region('compare'));
  mountAssistantButton(region('assistant'));
  mountAssistantDrawer(region('drawer'));

  await host.load();
  void analysis.start();
  const errors = await applyDeepLink(parseDeepLink(location.search), host.jumpTo);
  for (const e of errors) console.warn('Deep link:', e);
  syncUrl(store);
  document.getElementById('loading')!.classList.add('done');
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = 'Could not load the Moon. Run "npm run fetch-textures" and reload.';
});
