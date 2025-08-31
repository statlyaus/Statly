/**
 * Player Position Mapping Service
 * Maps player names to their correct AFL positions
 */

// Import the existing AFL players data
// import aflPlayers from '../data/aflPlayers';

// Create a map for fast lookups
const playerPositionMap = new Map<string, string>();

// Popular AFL players with their correct positions
const additionalPlayers: Array<{ name: string; position: string }> = [
  // Top AFL players not in the main data file
  { name: 'Max Gawn', position: 'RUC' },
  { name: 'Jordan Dawson', position: 'DEF' },
  { name: 'Brodie Grundy', position: 'RUC' },
  { name: 'Max Holmes', position: 'MID' },
  { name: 'Matt Rowell', position: 'MID' },
  { name: 'Jesse Hogan', position: 'FWD' },
  { name: 'Isaac Heeney', position: 'FWD' },
  { name: 'Errol Gulden', position: 'MID' },
  { name: 'Nick Daicos', position: 'MID' },
  { name: 'Sam Walsh', position: 'MID' },
  { name: 'Patrick Cripps', position: 'MID' },
  { name: 'Christian Petracca', position: 'MID' },
  { name: 'Clayton Oliver', position: 'MID' },
  { name: 'Marcus Bontempelli', position: 'MID' },
  { name: 'Lachie Neale', position: 'MID' },
  { name: 'Touk Miller', position: 'MID' },
  { name: 'Jeremy Cameron', position: 'FWD' },
  { name: 'Charlie Curnow', position: 'FWD' },
  { name: 'Tom Hawkins', position: 'FWD' },
  { name: 'Lance Franklin', position: 'FWD' },
  { name: 'Taylor Walker', position: 'FWD' },
  { name: 'Tom Lynch', position: 'FWD' },
  { name: 'Jack Crisp', position: 'DEF' },
  { name: 'Jake Lloyd', position: 'DEF' },
  { name: 'Daniel Rich', position: 'DEF' },
  { name: 'Shannon Hurn', position: 'DEF' },
  { name: 'Rory Laird', position: 'DEF' },
  { name: 'Todd Goldstein', position: 'RUC' },
  { name: 'Sean Darcy', position: 'RUC' },
  { name: 'Nic Naitanui', position: 'RUC' },
  { name: 'Tim English', position: 'RUC' },
  // Additional star players
  { name: 'Andrew Brayshaw', position: 'MID' },
  { name: 'Zac Butters', position: 'MID' },
  { name: 'Connor Rozee', position: 'FWD' },
  { name: 'Toby Greene', position: 'FWD' },
  { name: 'Tom Stewart', position: 'DEF' },
  { name: 'Jack Sinclair', position: 'DEF' },
  { name: 'Josh Dunkley', position: 'MID' },
  { name: 'Noah Anderson', position: 'MID' },
  { name: 'Tom Green', position: 'MID' },
  { name: 'James Sicily', position: 'DEF' },
  { name: 'Jack Martin', position: 'FWD' },
  { name: 'David Mundy', position: 'MID' },
  { name: 'Ben King', position: 'FWD' },
  { name: 'Mitch Duncan', position: 'MID' },
  { name: 'Ollie Wines', position: 'MID' },
  { name: 'Patrick Dangerfield', position: 'MID' },
  { name: 'Lachlan Sholl', position: 'MID' },
  { name: 'Jaidyn Stephenson', position: 'FWD' },
  { name: 'Zach Merrett', position: 'MID' },
  { name: 'Aaron Naughton', position: 'FWD' },
  { name: 'Jack Macrae', position: 'MID' },
  { name: 'Marlion Pickett', position: 'MID' },
  { name: 'Charlie Cameron', position: 'FWD' },
  { name: 'Luke Parker', position: 'MID' },
  { name: 'Ben Cunnington', position: 'MID' },
  { name: 'Jack Viney', position: 'MID' },
  { name: 'Steele Sidebottom', position: 'MID' },
  { name: 'Nick Haynes', position: 'DEF' },
  { name: 'Sam Docherty', position: 'DEF' },
  { name: 'Jack Riewoldt', position: 'FWD' },
  { name: 'Dayne Zorko', position: 'MID' },
  { name: 'Caleb Daniel', position: 'DEF' }, // Often plays as a defender despite being small
  { name: 'Dustin Martin', position: 'MID' },
  { name: 'Brandon Ellis', position: 'MID' },
  { name: 'Jack Billings', position: 'MID' },
  { name: 'Callum Mills', position: 'DEF' },
  { name: 'Luke Breust', position: 'FWD' },
  { name: 'Darcy Parish', position: 'MID' },
  { name: 'Sam Menegola', position: 'MID' },
  { name: 'Jack Ziebell', position: 'MID' },
  { name: 'David Zaharakis', position: 'MID' },
];

// Initialize the position map
// function initializePositionMap() {
//   // Add players from the AFL players data file
//   // TODO: Re-enable when @/data/aflPlayers is available
//   // aflPlayers.forEach((player: any) => {
//   //   const normalizedName = normalizePlayerName(player.name);
//   //   if (player.position) {
//   //     playerPositionMap.set(normalizedName, player.position);
//   //   }
//   // });
// }

// Add additional popular players
additionalPlayers.forEach(player => {
  const normalizedName = normalizePlayerName(player.name);
  playerPositionMap.set(normalizedName, player.position);
});

/**
 * Normalize player name for consistent matching
 * Handles variations in naming (spaces, case, punctuation)
 */
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '');
}