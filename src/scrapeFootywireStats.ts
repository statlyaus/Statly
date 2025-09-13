import axios from 'axios';
import * as cheerio from 'cheerio';
import { collection, addDoc } from 'firebase/firestore';

import { db } from '@/lib/firebaseClient';
import { logger } from '@/lib/logger';

import type { Player } from './types/players';
import type { Element } from 'domhandler';

// Replace with any valid match ID
const matchId = '11341'; // Example: A recent match
const url = `https://www.footywire.com/afl/footy/ft_match_statistics?mid=${matchId}&advv=Y`;

const scrapeStats = async () => {
  if (!db) {
    logger.error('Firebase database not initialized. Cannot save player stats.', undefined);
    return;
  }

  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const teamTables = $("table:contains('Kicks')");

  if (teamTables.length === 0) {
    logger.error(
      'Could not find team stats tables. The website structure may have changed.',
      undefined,
      { url }
    );
    return;
  }

  const allPromises: Promise<void>[] = [];

  teamTables.each((i: number, table: Element) => {
    try {
      const rows = $(table).find('tr').slice(1); // skip header
      const teamName: string = $(table).prevAll('b').first().text().trim();

      if (!teamName) {
        logger.warn(`Could not determine team name for table ${i + 1}. Skipping.`, {
          tableIndex: i + 1,
        });
        return;
      }

      const playerPromises = rows
        .map((_, row: Element) => {
          const cells = $(row).find('td');
          const name: string = $(cells[1]).text().trim();
          if (!name) return null;

          // Using a subset of the Player type for the scraped data
          const stats: Omit<Player, 'id' | 'position' | 'avg'> = {
            name,
            team: teamName,
            kicks: parseInt($(cells[2]).text(), 10) || 0,
            handballs: parseInt($(cells[3]).text(), 10) || 0,
            marks: parseInt($(cells[5]).text(), 10) || 0,
            tackles: parseInt($(cells[7]).text(), 10) || 0,
            goals: parseInt($(cells[8]).text(), 10) || 0,
            hitouts: parseInt($(cells[6]).text(), 10) || 0,
            clearances: parseInt($(cells[10]).text(), 10) || 0,
            inside50s: parseInt($(cells[11]).text(), 10) || 0,
            rebound50s: parseInt($(cells[12]).text(), 10) || 0,
            contestedPossessions: parseInt($(cells[13]).text(), 10) || 0,
          };

          // Use addDoc to auto-generate a unique ID
          return addDoc(collection(db as NonNullable<typeof db>, 'players'), stats)
            .then((docRef) => {
              logger.info(`Saved player ${name} (${teamName}) with ID: ${docRef.id}`, {
                playerName: name,
                team: teamName,
                playerId: docRef.id,
              });
            })
            .catch((err: unknown) => {
              logger.error(`Failed to save player ${name}`, err, {
                playerName: name,
                team: teamName,
              });
            });
        })
        .get() // .get() is a Cheerio method to convert to a standard array
        .filter(Boolean); // Remove any nulls

      allPromises.push(...playerPromises);
    } catch (error) {
      logger.error('An error occurred while processing a table', error, { tableIndex: i });
    }
  });

  await Promise.all(allPromises);
  logger.info('Scraping complete', { totalPromises: allPromises.length });
};

scrapeStats().catch((error) => {
  logger.error('A critical error occurred during scraping', error);
});
