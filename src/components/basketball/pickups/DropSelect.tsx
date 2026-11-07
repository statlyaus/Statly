'use client';

import { useOptimistic } from 'react';

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
  defaultId,
}: {
  path: string;
  params: SearchParams;
  options: DropOption[];
  /** null: no drop. */
  selected: string | null;
  /** The default drop, labelled as the lowest value. */
  defaultId: string | null;
}) {
  const { update, pending } = useParamNavigation(path, params);
  const [value, setValue] = useOptimistic(selected ?? 'none');
  return (
    <label className={`${fieldLabelStyles} w-full min-w-0 max-w-md`}>
      If I drop
      <select
        value={value}
        aria-busy={pending}
        onChange={(event) => {
          const drop = event.target.value;
          update({ drop }, () => setValue(drop));
        }}
        className={fieldStyles({ size: 'md' })}
      >
        {options.map((option) => (
          <option key={option.playerId} value={option.playerId}>
            {option.fullName}
            {option.onInjuredList ? ' (IL)' : ''}
            {option.value !== null ? ` · value ${formatSigned(option.value)}` : ''}
            {option.playerId === defaultId ? ' (lowest value)' : ''}
          </option>
        ))}
        <option value="none">Nobody (I have an open roster spot)</option>
      </select>
    </label>
  );
}
