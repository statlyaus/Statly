import type { DevFixtureScenario, DevFixtureScenarioId } from '../core/types';
import { fullLeaguesScenario } from './fullLeaguesScenario';

const SCENARIOS: Record<DevFixtureScenarioId, DevFixtureScenario> = {
  'full-leagues': fullLeaguesScenario,
};

export function getDevFixtureScenario(id: DevFixtureScenarioId) {
  return SCENARIOS[id];
}
