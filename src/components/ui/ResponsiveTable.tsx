'use client';

import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

interface TableColumn<T> {
  key: keyof T;
  label: string;
  render?: (value: any, row: T, index: number) => ReactNode;
  sortable?: boolean;
  mobileHidden?: boolean;
  mobileLabel?: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

interface ResponsiveTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  mobileCardView?: boolean;
  stickyHeader?: boolean;
  maxHeight?: string;
}

export default function ResponsiveTable<T extends Record<string, any>>({
  data,
  columns,
  loading = false,
  emptyMessage = 'No data available',
  onRowClick,
  className = '',
  mobileCardView = true,
  stickyHeader = false,
  maxHeight,
}: ResponsiveTableProps<T>) {
  const [sortConfig, setSortConfig] = useState<{
    key: keyof T | null;
    direction: 'asc' | 'desc';
  }>({ key: null, direction: 'asc' });

  const handleSort = (key: keyof T) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedData = React.useMemo(() => {
    if (!sortConfig.key) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key!];
      const bValue = b[sortConfig.key!];

      if (aValue === bValue) return 0;

      const comparison = aValue < bValue ? -1 : 1;
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [data, sortConfig]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="animate-pulse">
          <div className="h-12 bg-gray-200"></div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 border-t border-gray-200"></div>
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table View */}
      <div className={`hidden lg:block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${className}`}>
        <div 
          className="overflow-auto"
          style={{ maxHeight }}
        >
          <table className="w-full">
            <thead className={`bg-gray-50 ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
              <tr>
                {columns.map((column) => (
                  <th
                    key={String(column.key)}
                    className={`table-header-padding text-xs font-medium text-gray-500 uppercase tracking-wider ${
                      column.align === 'center' ? 'text-center' : 
                      column.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                    style={{ width: column.width }}
                  >
                    {column.sortable ? (
                      <button
                        onClick={() => handleSort(column.key)}
                        className="flex items-center gap-1 hover:text-gray-700 focus:outline-none"
                      >
                        {column.label}
                        {sortConfig.key === column.key && (
                          sortConfig.direction === 'asc' ? 
                            <ChevronUpIcon className="w-4 h-4" /> : 
                            <ChevronDownIcon className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedData.map((row, index) => (
                <tr
                  key={index}
                  className={`hover:bg-gray-50 transition-colors ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onRowClick?.(row, index)}
                >
                  {columns.map((column) => {
                    const value = row[column.key];
                    return (
                      <td
                        key={String(column.key)}
                        className={`table-cell-padding text-sm text-gray-900 ${
                          column.align === 'center' ? 'text-center' : 
                          column.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {column.render ? column.render(value, row, index) : String(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      {mobileCardView && (
        <div className="lg:hidden space-y-4">
          {sortedData.map((row, index) => (
            <div
              key={index}
              className={`bg-white rounded-lg shadow-sm border border-gray-200 card-padding ${
                onRowClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
              }`}
              onClick={() => onRowClick?.(row, index)}
            >
              {columns
                .filter(column => !column.mobileHidden)
                .map((column) => {
                  const value = row[column.key];
                  const label = column.mobileLabel || column.label;
                  
                  return (
                    <div key={String(column.key)} className="flex justify-between items-center py-2">
                      <span className="text-sm font-medium text-gray-500">{label}:</span>
                      <span className="text-sm text-gray-900">
                        {column.render ? column.render(value, row, index) : String(value)}
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}

      {/* Mobile Table View (fallback) */}
      {!mobileCardView && (
        <div className="lg:hidden bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead className="bg-gray-50">
                <tr>
                  {columns
                    .filter(column => !column.mobileHidden)
                    .map((column) => (
                      <th
                        key={String(column.key)}
                        className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider text-left"
                      >
                        {column.sortable ? (
                          <button
                            onClick={() => handleSort(column.key)}
                            className="flex items-center gap-1 hover:text-gray-700 focus:outline-none"
                          >
                            {column.label}
                            {sortConfig.key === column.key && (
                              sortConfig.direction === 'asc' ? 
                                <ChevronUpIcon className="w-3 h-3" /> : 
                                <ChevronDownIcon className="w-3 h-3" />
                            )}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedData.map((row, index) => (
                  <tr
                    key={index}
                    className={`hover:bg-gray-50 transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => onRowClick?.(row, index)}
                  >
                    {columns
                      .filter(column => !column.mobileHidden)
                      .map((column) => {
                        const value = row[column.key];
                        return (
                          <td
                            key={String(column.key)}
                            className="px-3 py-3 text-sm text-gray-900"
                          >
                            {column.render ? column.render(value, row, index) : String(value)}
                          </td>
                        );
                      })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// Hook for table state management
export function useTableState<T>(initialData: T[]) {
  const [data, setData] = useState<T[]>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateData = (newData: T[]) => {
    setData(newData);
    setError(null);
  };

  const setLoadingState = (isLoading: boolean) => {
    setLoading(isLoading);
  };

  const setErrorState = (errorMessage: string | null) => {
    setError(errorMessage);
    setLoading(false);
  };

  return {
    data,
    loading,
    error,
    updateData,
    setLoadingState,
    setErrorState,
  };
}
