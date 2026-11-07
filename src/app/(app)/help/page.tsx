import type { ReactNode } from 'react';

import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

// The rules here restate docs/product/league-competition-rules.md and docs/domain/. Change them together.

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5 text-card-foreground">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">How Statly works</h1>
        <p className="text-muted-foreground">
          Statly is a category head-to-head league. There are no player prices, break-evens or trade
          limits: you draft a squad, set a lineup each round and try to win more stat categories
          than your opponent.
        </p>
      </header>

      <Section title="A round">
        <p>
          Each fantasy round you play one other team. For every category in your league, the
          combined totals of both teams&apos; active lineup players are compared. The higher total
          wins the category, unless your league marks it &quot;lower wins&quot;, in which case the
          lower total wins. Equal totals are a draw.
        </p>
        <p>
          An AFL club bye does not cancel your matchup; those players simply have no game. A round
          your league leaves out of the schedule is a no-matchup week and counts as nothing.
        </p>
      </Section>

      <Section title="Categories">
        <p>New leagues start with these nine categories, all higher wins:</p>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          {REAL_DATA_NINE_CATEGORY_PRESET.map((key) => (
            <li key={key} className="text-foreground">
              {FANTASY_CATEGORIES[key].label}
            </li>
          ))}
        </ul>
        <p>
          The commissioner can choose different categories and set any of them to lower wins before
          the league is published. Your league settings show the ones in play.
        </p>
      </Section>

      <Section title="Scoring">
        <p>Your league uses one of two scoring modes:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-foreground">Each category:</strong> every category you win, lose
            or draw goes on your record. A 6–3 round adds six wins and three losses.
          </li>
          <li>
            <strong className="text-foreground">Most categories:</strong> the team that wins more
            categories wins the round. A 6–3 round is one win. Equal category wins is a draw.
          </li>
        </ul>
      </Section>

      <Section title="The draft">
        <p>
          The draft runs in snake order: the order reverses every round. When it is your turn, press
          Select on a player, then confirm. Queue players ahead of time; if your clock runs out,
          Statly picks the first available player in your queue, or otherwise the best available
          player by Statly Z.
        </p>
        <p>
          Statly Z is the default ranking in the draft room and on waivers. It adds up how far a
          player sits above or below the available pool in each of your league&apos;s categories,
          counting a lower-wins category the other way round.
        </p>
      </Section>

      <Section title="Lineups and locks">
        <p>
          Active slots are defenders, midfielders, rucks, forwards and, if your league has one, a
          utility. Only active players score. Interchange players score only if an autosub brings
          them on. Lineup changes save automatically.
        </p>
        <p>
          By default each player locks when their AFL match starts. Some leagues lock the whole
          round at 7 pm Thursday, Sydney time. A locked player cannot be moved, dropped or replaced.
        </p>
      </Section>

      <Section title="Autosubs">
        <p>
          After the AFL round, any active player who did not play is replaced by the first
          interchange player, in your interchange order, who played and fits that slot. If nobody
          qualifies, the slot scores nothing. Reordering your unlocked interchange players changes
          who comes on first.
        </p>
      </Section>

      <Section title="Waivers">
        <p>
          A dropped player sits on waivers for 24 hours. Claims run once a day at 6 am Melbourne
          time, from your league&apos;s Waivers tab.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-foreground">Bidding leagues:</strong> each manager has a budget
            set by the commissioner. The highest bid wins, with a minimum bid of 1; a tie goes to
            waiver priority. You are only charged if you get the player.
          </li>
          <li>
            <strong className="text-foreground">Priority leagues:</strong> the claim from the
            manager highest in waiver priority wins, and that manager moves to the back of the
            order.
          </li>
        </ul>
        <p>
          Your bids stay private. The league&apos;s Activity feed shows only claims that were won or
          missed.
        </p>
      </Section>

      <Section title="Trades">
        <p>
          Propose trades from your league&apos;s Trade Centre. What happens when a trade is accepted
          depends on the league:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>it goes through straight away,</li>
          <li>it waits for the commissioner to approve it, or</li>
          <li>other managers have a review period to veto it; enough vetoes cancel it.</li>
        </ul>
        <p>The offer card shows which stage your trade is in.</p>
      </Section>

      <Section title="Standings and finals">
        <p>
          Each-category leagues rank by category wins, losses and draws; most-categories leagues
          rank by round results. The commissioner picks a tie-break category. The top 4, 6 or 8
          teams make finals, seeded from the regular-season ladder. A drawn final goes to the higher
          seed.
        </p>
      </Section>
    </div>
  );
}
