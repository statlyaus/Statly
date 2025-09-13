declare module 'react-window' {
  import type * as React from 'react';

  export type ListChildComponentProps<T = any> = {
    index: number;
    style: React.CSSProperties;
    data: T;
    isScrolling?: boolean;
  };

  export interface FixedSizeListProps {
    height: number;
    width: number | string;
    itemCount: number;
    itemSize: number;
    itemData?: any;
    overscanCount?: number;
    outerRef?: React.Ref<any>;
    itemKey?: (index: number, data?: any) => string | number;
    children: (props: ListChildComponentProps<any>) => React.ReactElement | null;
  }

  export interface VariableSizeListProps {
    height: number;
    width: number | string;
    itemCount: number;
    itemSize: (index: number) => number;
    itemData?: any;
    overscanCount?: number;
    outerRef?: React.Ref<any>;
    itemKey?: (index: number, data?: any) => string | number;
    onItemsRendered?: (args: {
      overscanStartIndex: number;
      overscanStopIndex: number;
      visibleStartIndex: number;
      visibleStopIndex: number;
    }) => void;
    children: (props: ListChildComponentProps<any>) => React.ReactElement | null;
  }

  /* Export both values and types so TS allows using them in JSX and as type params */
  export const FixedSizeList: React.ComponentType<any>;
  export const VariableSizeList: React.ComponentType<any>;

  export type FixedSizeList = any;
  export type VariableSizeList = any;
}
