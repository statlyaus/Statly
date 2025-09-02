# PlayerCard Configuration Improvements

## Overview

Enhanced the `CARD_STYLES` configuration in `playerCardConfig.ts` for better readability, maintainability, and variant-specific styling.

## Changes Made

### 1. **Improved Readability**

**Before:**

```typescript
base: `relative bg-white border border-gray-200 ${leagueDesignTokens.rounded.lg} transition-all`,
```

**After:**

```typescript
// Base style components for better readability
foundation: 'relative bg-white border border-gray-200',
shape: leagueDesignTokens.rounded.lg,
animation: 'transition-all duration-200',

// Composed base style using getter for dynamic composition
get base() {
  return [
    this.foundation,
    this.shape,
    this.animation,
  ].join(' ');
},
```

### 2. **Variant-Specific Hover States**

**Before:** Generic hover classes that could collide

```typescript
interactive: 'cursor-pointer hover:border-blue-300 hover:shadow-sm',
interactiveDetailed: 'cursor-pointer hover:border-blue-300 hover:shadow-md',
```

**After:** Scoped variant-specific hover behaviors

```typescript
compact: {
  get interactive() {
    return 'cursor-pointer hover:border-blue-300 hover:shadow-sm hover:bg-gray-50 group';
  },
},

detailed: {
  get interactive() {
    return 'cursor-pointer hover:border-blue-300 hover:shadow-lg hover:transform hover:scale-[1.02] group';
  },
},
```

### 3. **Component Usage Updates**

Updated `PlayerCard.tsx` to use variant-specific styles:

**Compact Variant:**

```typescript
className={`
  ${CARD_STYLES.compact.base}
  ${selectable || onClick ? CARD_STYLES.compact.interactive : ''}
  // ... other classes
`}
```

**Detailed Variant:**

```typescript
className={`
  ${CARD_STYLES.detailed.base}
  ${selectable || onClick ? CARD_STYLES.detailed.interactive : ''}
  // ... other classes
`}
```

## Benefits

1. **Better Readability**: Style composition is clearer and easier to understand
2. **Maintainability**: Individual style tokens can be modified independently
3. **Variant Specificity**: Each card variant has tailored hover behaviors
4. **No Style Collisions**: Scoped hover states prevent unexpected interactions
5. **Documentation**: JSDoc comments explain the purpose of each style group
6. **Performance**: Getters ensure styles are composed only when needed

## Hover Behavior Differences

- **Compact Cards**: Subtle hover with light background change
- **Detailed Cards**: Enhanced hover with scale transform and stronger shadow
- **Group Scoping**: Added `group` class for potential child hover effects

## Backward Compatibility

Legacy `interactive` and `interactiveDetailed` properties are maintained for backward compatibility, though new code should use the variant-specific styles.

This refactoring makes the styling system more maintainable while providing better UX differentiation between card variants.
