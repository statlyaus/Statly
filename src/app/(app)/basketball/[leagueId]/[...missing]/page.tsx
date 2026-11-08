import { notFound } from 'next/navigation';

// An unknown page under a league. Without this catch-all an unmatched URL gets the root not-found
// page, outside the league; here the layout first checks the league is the user's, then the league's
// own not-found renders under its header and tabs. Real sections are static routes and win.
export default function MissingBasketballLeaguePage(): never {
  notFound();
}
