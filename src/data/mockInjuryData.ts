// Mock AFL injury data for testing and demonstration
export interface MockInjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

export const mockInjuryData: MockInjuryData[] = [
  // Adelaide Crows
  {
    id: 'james-peatling-adelaide',
    name: 'James Peatling',
    team: 'Adelaide',
    position: 'MID',
    injury: 'Thigh',
    status: 'Test',
    expectedReturn: 'Test',
    details: 'Minor thigh strain, will be assessed'
  },
  {
    id: 'josh-rachele-adelaide',
    name: 'Josh Rachele',
    team: 'Adelaide',
    position: 'FWD',
    injury: 'Knee',
    status: 'TBC',
    expectedReturn: 'TBC',
    details: 'Knee soreness, timeline to be confirmed'
  },
  {
    id: 'lachlan-mcandrew-adelaide',
    name: 'Lachlan McAndrew',
    team: 'Adelaide',
    position: 'RUC',
    injury: 'Jaw',
    status: '2-3 weeks',
    expectedReturn: '2-3 weeks',
    details: 'Jaw injury requiring recovery time'
  },
  {
    id: 'max-michalanney-adelaide',
    name: 'Max Michalanney',
    team: 'Adelaide',
    position: 'MID',
    injury: 'Hamstring',
    status: '2-3 weeks',
    expectedReturn: '2-3 weeks',
    details: 'Hamstring strain'
  },
  {
    id: 'oscar-ryan-adelaide',
    name: 'Oscar Ryan',
    team: 'Adelaide',
    position: 'DEF',
    injury: 'Hamstring',
    status: '5-6 weeks',
    expectedReturn: '5-6 weeks',
    details: 'Significant hamstring injury'
  },

  // Brisbane Lions
  {
    id: 'brandon-starcevich-brisbane',
    name: 'Brandon Starcevich',
    team: 'Brisbane',
    position: 'DEF',
    injury: 'Hamstring',
    status: 'Test',
    expectedReturn: 'Test',
    details: 'Minor hamstring concern'
  },
  {
    id: 'conor-mckenna-brisbane',
    name: 'Conor McKenna',
    team: 'Brisbane',
    position: 'DEF',
    injury: 'Hamstring',
    status: '2 weeks',
    expectedReturn: '2 weeks',
    details: 'Hamstring strain recovery'
  },
  {
    id: 'jack-payne-brisbane',
    name: 'Jack Payne',
    team: 'Brisbane',
    position: 'DEF',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'kai-lohmann-brisbane',
    name: 'Kai Lohmann',
    team: 'Brisbane',
    position: 'FWD',
    injury: 'Leg/Calf',
    status: '1 week',
    expectedReturn: '1 week',
    details: 'Minor calf strain'
  },
  {
    id: 'keidean-coleman-brisbane',
    name: 'Keidean Coleman',
    team: 'Brisbane',
    position: 'DEF',
    injury: 'Quad',
    status: '6-7 weeks',
    expectedReturn: '6-7 weeks',
    details: 'Quadriceps injury'
  },
  {
    id: 'lachie-neale-brisbane',
    name: 'Lachie Neale',
    team: 'Brisbane',
    position: 'MID',
    injury: 'Quad',
    status: '2 weeks',
    expectedReturn: '2 weeks',
    details: 'Quadriceps strain'
  },
  {
    id: 'lincoln-mccarthy-brisbane',
    name: 'Lincoln McCarthy',
    team: 'Brisbane',
    position: 'FWD',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee reconstruction'
  },
  {
    id: 'noah-answerth-brisbane',
    name: 'Noah Answerth',
    team: 'Brisbane',
    position: 'DEF',
    injury: 'Leg/Calf',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending leg injury'
  },

  // Carlton Blues
  {
    id: 'adam-cerra-carlton',
    name: 'Adam Cerra',
    team: 'Carlton',
    position: 'MID',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'brodie-kemp-carlton',
    name: 'Brodie Kemp',
    team: 'Carlton',
    position: 'DEF',
    injury: 'Leg/Calf',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending leg injury'
  },
  {
    id: 'charlie-curnow-carlton',
    name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'harry-lemmey-carlton',
    name: 'Harry Lemmey',
    team: 'Carlton',
    position: 'RUC',
    injury: 'Hamstring',
    status: 'Test',
    expectedReturn: 'Test',
    details: 'Hamstring concern, will be tested'
  },
  {
    id: 'harry-ofarrell-carlton',
    name: "Harry O'Farrell",
    team: 'Carlton',
    position: 'DEF',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'jack-silvagni-carlton',
    name: 'Jack Silvagni',
    team: 'Carlton',
    position: 'FWD',
    injury: 'Hip/Groin',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending hip/groin injury'
  },
  {
    id: 'jagga-smith-carlton',
    name: 'Jagga Smith',
    team: 'Carlton',
    position: 'MID',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'matt-cottrell-carlton',
    name: 'Matt Cottrell',
    team: 'Carlton',
    position: 'MID',
    injury: 'Foot',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending foot injury'
  },
  {
    id: 'nic-newman-carlton',
    name: 'Nic Newman',
    team: 'Carlton',
    position: 'DEF',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'sam-walsh-carlton',
    name: 'Sam Walsh',
    team: 'Carlton',
    position: 'MID',
    injury: 'Foot',
    status: 'Test',
    expectedReturn: 'Test',
    details: 'Foot injury, fitness test required'
  },

  // Collingwood Magpies
  {
    id: 'beau-mccreery-collingwood',
    name: 'Beau McCreery',
    team: 'Collingwood',
    position: 'FWD',
    injury: 'Hamstring',
    status: 'Test',
    expectedReturn: 'Test',
    details: 'Hamstring tightness, will be tested'
  },
  {
    id: 'bobby-hill-collingwood',
    name: 'Bobby Hill',
    team: 'Collingwood',
    position: 'FWD',
    injury: 'Illness',
    status: 'Test',
    expectedReturn: 'Test',
    details: 'Illness, availability to be assessed'
  },
  {
    id: 'charlie-west-collingwood',
    name: 'Charlie West',
    team: 'Collingwood',
    position: 'DEF',
    injury: 'Foot',
    status: '4 weeks',
    expectedReturn: '4 weeks',
    details: 'Foot injury requiring 4 weeks recovery'
  },
  {
    id: 'harvey-harrison-collingwood',
    name: 'Harvey Harrison',
    team: 'Collingwood',
    position: 'MID',
    injury: 'Knee',
    status: 'Season',
    expectedReturn: 'Season',
    details: 'Season-ending knee injury'
  },
  {
    id: 'iliro-smit-collingwood',
    name: 'Iliro Smit',
    team: 'Collingwood',
    position: 'RUC',
    injury: 'Foot',
    status: '6+ weeks',
    expectedReturn: '6+ weeks',
    details: 'Serious foot injury'
  },
  {
    id: 'jakob-ryan-collingwood',
    name: 'Jakob Ryan',
    team: 'Collingwood',
    position: 'DEF',
    injury: 'Foot',
    status: '6 weeks',
    expectedReturn: '6 weeks',
    details: 'Foot injury requiring extended recovery'
  },
  {
    id: 'jeremy-howe-collingwood',
    name: 'Jeremy Howe',
    team: 'Collingwood',
    position: 'DEF',
    injury: 'Head',
    status: 'Protocols',
    expectedReturn: 'Protocols',
    details: 'Concussion protocols, timeline dependent on clearance'
  }
];

export function getInjuriesByTeam(teamName?: string): MockInjuryData[] {
  if (!teamName) {
    return mockInjuryData;
  }
  
  return mockInjuryData.filter(injury => 
    injury.team.toLowerCase() === teamName.toLowerCase()
  );
}

export function getInjuryCount(teamName?: string): number {
  return getInjuriesByTeam(teamName).length;
}
