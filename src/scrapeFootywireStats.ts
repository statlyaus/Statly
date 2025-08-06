import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { db } from '@/lib/firebaseClient';
import { collection, addDoc } from 'firebase/firestore';
import type { Player } from './types';

// Replace with any valid match ID
const matchId = '11341'; // Example: A recent match
const url = `https://www.footywire.com/afl/footy/ft_match_statistics?mid=${matchId}&advv=Y`;

const scrapeStats = async () => {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const teamTables = $("table:contains('Kicks')");

  if (teamTables.length === 0) {
    console.error('Could not find team stats tables. The website structure may have changed.');
    return;
  }

  const allPromises: Promise<void>[] = [];

  teamTables.each(async (i: number, table: Element) => {
    try {
      const rows = $(table).find('tr').slice(1); // skip header
      const teamName: string = $(table).prevAll('b').first().text().trim();

      if (!teamName) {
        console.warn(`Could not determine team name for table ${i + 1}. Skipping.`);
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
          return addDoc(collection(db, 'players'), stats)
            .then((docRef) => {
              console.log(`✅ Saved ${name} (${teamName}) with ID: ${docRef.id}`);
            })
            .catch((err: unknown) => {
              console.error(`❌ Failed to save ${name}`, err);
            });
        })
        .get() // .get() is a Cheerio method to convert to a standard array
        .filter(Boolean); // Remove any nulls

      allPromises.push(...playerPromises);
    } catch (error) {
      console.error('An error occurred while processing a table:', error);
    }
  });

  await Promise.all(allPromises);
  console.log('✨ Scraping complete.');
};

scrapeStats().catch((error) => {
  console.error('A critical error occurred during scraping:', error);
});
