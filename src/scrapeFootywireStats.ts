import axios from "axios";
import cheerio from "cheerio";
import { db } from "./firebase";
import { setDoc, doc } from "firebase/firestore";

// Replace with any valid match ID
const matchId = "11341";
const url = `https://www.footywire.com/afl/footy/ft_match_statistics?mid=${matchId}&advv=Y`;

const scrapeStats = async () => {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const teamTables = $("table:contains('Kicks')");

  teamTables.each((i, table) => {
    const rows = $(table).find("tr").slice(1); // skip header
    const teamName = $(table).prevAll("b").first().text().trim();

    rows.each(async (_, row) => {
      const cells = $(row).find("td");
      const name = $(cells[1]).text().trim();
      if (!name) return;

      const stats = {
        team: teamName,
        kicks: parseInt($(cells[2]).text(), 10),
        handballs: parseInt($(cells[3]).text(), 10),
        disposals: parseInt($(cells[4]).text(), 10),
        marks: parseInt($(cells[5]).text(), 10),
        hitouts: parseInt($(cells[6]).text(), 10),
        tackles: parseInt($(cells[7]).text(), 10),
        goals: parseInt($(cells[8]).text(), 10),
        behinds: parseInt($(cells[9]).text(), 10),
        clearances: parseInt($(cells[10]).text(), 10),
        inside50s: parseInt($(cells[11]).text(), 10),
        rebound50s: parseInt($(cells[12]).text(), 10),
        contestedPossessions: parseInt($(cells[13]).text(), 10),
        uncontestedPossessions: parseInt($(cells[14]).text(), 10),
        turnovers: parseInt($(cells[15]).text(), 10),
        intercepts: parseInt($(cells[16]).text(), 10),
      };

      try {
        await setDoc(doc(db, "players", name), { ...stats, name });
        console.log(`✅ Saved ${name} (${teamName})`);
      } catch (err) {
        console.error(`❌ Failed for ${name}`, err);
      }
    });
  });
};

scrapeStats();