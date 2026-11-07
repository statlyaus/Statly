'use client';

import { fieldLabelStyles, fieldStyles } from '@/components/ui/controlStyles';
import type { DropOption } from '@/server/basketball/readModels/pickupsModel';

import { formatSigned } from '../analysis/format';
import type { SearchParams } from '../analysis/searchParams';
import { useParamNavigation } from '../analysis/useParamNavigation';

/** Chooses the player to drop; the page re-ranks free agents on the server. */
export function DropSelect({
  path,
  params,
  options,
  selected,
}: {
  path: string;
  params: SearchParams;
  options: DropOption[];
  /** null: no drop. */
  selected: string | null;
}) {
  const { update, pending } = useParamNavigation(path, params);
  return (
    <label className={`${fieldLabelStyles} max-w-md`}>
      If I drop
      <select
        value={selected ?? 'none'}
        aria-busy={pending}
        onChange={(event) => update({ drop: event.target.value })}
        className={fieldStyles({ size: 'md' })}
      >
        {options.map((option) => (
          <option key={option.playerId} value={option.playerId}>
            {option.fullName}
            {option.onInjuredList ? ' (IL)' : ''}
            {option.value !== null ? ` · value ${formatSigned(option.value)}` : ''}
          </option>
        ))}
        <option value="none">Nobody (I have an open roster spot)</option>
      </select>
    </label>
  );
}
