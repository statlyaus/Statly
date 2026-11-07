'use client';

import {
  BASKETBALL_CATEGORIES,
  EIGHT_CATEGORY_PRESET,
  NINE_CATEGORY_PRESET,
  type BasketballCategoryId,
} from '@/types/basketball';

import { FieldError, FieldHelp, FormSection, describedBy } from '../../shell/formParts';

import type { LeagueSectionProps } from './sectionProps';

const PRESETS = [
  { id: 'nine', label: '9-category', categories: NINE_CATEGORY_PRESET },
  { id: 'eight', label: '8-category (no turnovers)', categories: EIGHT_CATEGORY_PRESET },
] as const;

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function CategoriesSection({ values, update, error, ids }: LeagueSectionProps) {
  const preset = PRESETS.find((option) => sameSet(option.categories, values.categories));

  function toggleCategory(id: BasketballCategoryId, checked: boolean) {
    update(
      'categories',
      checked ? [...values.categories, id] : values.categories.filter((category) => category !== id)
    );
    // An uncounted category cannot stay punted.
    if (!checked) {
      update(
        'puntCategories',
        values.puntCategories.filter((category) => category !== id)
      );
    }
  }

  return (
    <FormSection
      id="bb-categories"
      title="Categories"
      summary="Statly values players and projects matchups only on the categories you count."
    >
      <fieldset
        id={ids.categories}
        tabIndex={-1}
        aria-describedby={describedBy(ids.categories, true, error('categories'))}
        className="flex flex-col gap-2 outline-none"
      >
        <legend className="text-sm font-semibold text-foreground">Counted categories</legend>
        <FieldHelp id={ids.categories}>Pick a preset, or tick categories one by one.</FieldHelp>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category preset">
          {PRESETS.map((option) => (
            <label
              key={option.id}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name="category-preset"
                checked={preset?.id === option.id}
                onChange={() => {
                  update('categories', [...option.categories]);
                  update(
                    'puntCategories',
                    values.puntCategories.filter((punt) => option.categories.includes(punt))
                  );
                }}
                className="size-4 accent-brand-bar focus:outline-none"
              />
              {option.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BASKETBALL_CATEGORIES.map((category) => (
            <label
              key={category.id}
              className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-md border border-border px-3 py-1.5 leading-tight has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="checkbox"
                checked={values.categories.includes(category.id)}
                onChange={(event) => toggleCategory(category.id, event.target.checked)}
                className="row-span-2 size-4 accent-brand-bar focus:outline-none"
              />
              <span className="text-sm font-bold text-foreground">{category.shortLabel}</span>
              <span className="truncate text-xs text-muted-foreground">{category.label}</span>
            </label>
          ))}
        </div>
        <FieldError id={ids.categories} error={error('categories')} />
      </fieldset>

      <fieldset
        id={ids.punts}
        tabIndex={-1}
        aria-describedby={describedBy(ids.punts, true, error('puntCategories'))}
        className="flex flex-col gap-2 outline-none"
      >
        <legend className="text-sm font-semibold text-foreground">Punts (optional)</legend>
        <FieldHelp id={ids.punts}>
          Punted categories are left out of player value, so rankings favour players who help
          everywhere else. You can also try punts on the Players page.
        </FieldHelp>
        <div className="flex flex-wrap gap-2">
          {BASKETBALL_CATEGORIES.filter((category) => values.categories.includes(category.id)).map(
            (category) => (
              <label
                key={category.id}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold has-[:checked]:border-brand-bar has-[:checked]:bg-brand-bar/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="checkbox"
                  checked={values.puntCategories.includes(category.id)}
                  onChange={(event) =>
                    update(
                      'puntCategories',
                      event.target.checked
                        ? [...values.puntCategories, category.id]
                        : values.puntCategories.filter((punt) => punt !== category.id)
                    )
                  }
                  className="size-4 accent-brand-bar focus:outline-none"
                />
                <span>
                  <span className="sr-only">Punt </span>
                  {category.shortLabel}
                </span>
              </label>
            )
          )}
        </div>
        <FieldError id={ids.punts} error={error('puntCategories')} />
      </fieldset>
    </FormSection>
  );
}
