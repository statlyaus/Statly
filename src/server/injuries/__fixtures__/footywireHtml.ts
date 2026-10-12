/**
 * Builders for Footywire injury list markup in the shape `parseFootywireInjuryList` reads: one table
 * per club headed by a `td.tbtitle` cell, then one `tr.darkcolor` row per player. The trimmed live
 * page in `footywire-injury-list.html` is the reference; these build the variants it cannot cover.
 */

export function injuryListPage(...tables: string[]): string {
  return `<html><body>${tables.join('')}</body></html>`;
}

export function clubTable(header: string, rows: readonly string[]): string {
  return `<table><tr><td class="tbtitle">${header}</td></tr><tr><td><table>
    <tr><td class="lbnorm">&nbsp; Player</td><td class="bnorm">Injury</td><td class="bnorm">Returning</td></tr>
    ${rows.join('\n')}
  </table></td></tr></table>`;
}

export function playerRow(href: string, name: string, injury: string, returning: string): string {
  return `<tr class="darkcolor"><td>&nbsp; <a href="${href}">${name}</a></td><td>${injury}</td><td>${returning}</td></tr>`;
}
