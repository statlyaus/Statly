'use client';

import React, { useState, useMemo } from 'react';
import type { ReactNode } from 'react';

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Funnel, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { cn } from '@/lib/utils';

import { UIInput } from './input';
import { UITable, tableClasses, tableStateClasses } from './table';

// Generic column definition
export interface TableColumn<T = Record<string, unknown>> {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: unknown, row: T, index: number) => ReactNode;
  sortFn?: (a: T, b: T) => number;
  filterFn?: (value: unknown, searchTerm: string) => boolean;
}

// Sort configuration
type SortConfig<T> = {
  key: keyof T | null;
  direction: 'asc' | 'desc';
} | null;

// Filter configuration
interface FilterConfig {
  [key: string]: string;
}

// Pagination configuration
interface PaginationConfig {
  page: number;
  pageSize: number;
  showPagination: boolean;
}

// Component props
interface DataTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  loading?: boolean;
  emptyMessage?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  globalSearch?: boolean;
  pagination?: Partial<PaginationConfig>;
  className?: string;
  rowClassName?: string | ((row: T, index: number) => string);
  onRowClick?: (row: T, index: number) => void;
  stickyHeader?: boolean;
  maxHeight?: string;
}

// Default pagination config
const DEFAULT_PAGINATION: PaginationConfig = {
  page: 1,
  pageSize: 10,
  showPagination: true,
};

const controlButtonClasses =
  'inline-flex items-center rounded-md border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

const getAlignmentClass = (align?: TableColumn['align']) =>
  align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

export default function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  loading = false,
  emptyMessage = 'No data available',
  searchable = true,
  searchPlaceholder = 'Search...',
  globalSearch = true,
  pagination: paginationProps = {},
  className = '',
  rowClassName = '',
  onRowClick,
  stickyHeader = false,
  maxHeight = 'auto',
}: DataTableProps<T>) {
  // State management
  const [sortConfig, setSortConfig] = useState<SortConfig<T>>(null);
  const [filterConfig, setFilterConfig] = useState<FilterConfig>({});
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Pagination config
  const paginationConfig: PaginationConfig = useMemo(
    () => ({
      ...DEFAULT_PAGINATION,
      ...paginationProps,
    }),
    [paginationProps]
  );

  const [currentPage, setCurrentPage] = useState(paginationConfig.page);

  // Sorting logic
  const handleSort = (column: TableColumn<T>) => {
    if (!column.sortable) return;

    const key = column.key as keyof T;
    let direction: 'asc' | 'desc' = 'asc';

    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }

    setSortConfig({ key, direction });
  };

  // Filter logic
  const handleFilterChange = (columnKey: string, value: string) => {
    setFilterConfig((prev) => ({
      ...prev,
      [columnKey]: value,
    }));
    setCurrentPage(1); // Reset to first page when filtering
  };

  // Global search logic
  const handleGlobalSearch = (value: string) => {
    setGlobalSearchTerm(value);
    setCurrentPage(1); // Reset to first page when searching
  };

  // Data processing pipeline
  const processedData = useMemo(() => {
    let result = [...data];

    // Apply global search
    if (globalSearch && globalSearchTerm) {
      result = result.filter((row) => {
        return columns.some((column) => {
          const value = row[column.key];
          if (column.filterFn) {
            return column.filterFn(value, globalSearchTerm);
          }
          return String(value || '')
            .toLowerCase()
            .includes(globalSearchTerm.toLowerCase());
        });
      });
    }

    // Apply column-specific filters
    Object.entries(filterConfig).forEach(([columnKey, searchTerm]) => {
      if (searchTerm) {
        const column = columns.find((col) => col.key === columnKey);
        result = result.filter((row) => {
          const value = row[columnKey];
          if (column?.filterFn) {
            return column.filterFn(value, searchTerm);
          }
          return String(value || '')
            .toLowerCase()
            .includes(searchTerm.toLowerCase());
        });
      }
    });

    // Apply sorting
    if (sortConfig) {
      const column = columns.find((col) => col.key === sortConfig.key);
      result.sort((a, b) => {
        if (column?.sortFn) {
          return sortConfig.direction === 'asc' ? column.sortFn(a, b) : column.sortFn(b, a);
        }

        const aVal = a[sortConfig.key!];
        const bVal = b[sortConfig.key!];

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, columns, sortConfig, filterConfig, globalSearchTerm, globalSearch]);

  // Pagination logic
  const paginatedData = useMemo(() => {
    if (!paginationConfig.showPagination) return processedData;

    const startIndex = (currentPage - 1) * paginationConfig.pageSize;
    const endIndex = startIndex + paginationConfig.pageSize;
    return processedData.slice(startIndex, endIndex);
  }, [processedData, currentPage, paginationConfig]);

  const totalPages = Math.ceil(processedData.length / paginationConfig.pageSize);

  // Helper functions
  const getSortIcon = (column: TableColumn<T>) => {
    if (!column.sortable) return null;

    const isActive = sortConfig?.key === column.key;
    const direction = sortConfig?.direction;

    if (isActive && direction === 'asc') {
      return <ChevronUp className="h-4 w-4" aria-hidden="true" />;
    }
    if (isActive && direction === 'desc') {
      return <ChevronDown className="h-4 w-4" aria-hidden="true" />;
    }
    return <ChevronUp className="h-4 w-4 opacity-40" aria-hidden="true" />;
  };

  const getRowClassName = (row: T, index: number) => {
    if (typeof rowClassName === 'function') {
      return rowClassName(row, index);
    }
    return rowClassName;
  };

  // Loading state
  if (loading) {
    return (
      <div className={cn(tableClasses.container, className)}>
        <div className={tableStateClasses.loading}>
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(tableClasses.container, className)}>
      {/* Search and Filter Controls */}
      {searchable && (
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between gap-4">
            {/* Global Search */}
            {globalSearch && (
              <div className="flex-1 relative">
                <Search
                  className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <UIInput
                  type="text"
                  placeholder={searchPlaceholder}
                  value={globalSearchTerm}
                  onChange={(e) => handleGlobalSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            )}

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                controlButtonClasses,
                'px-3 py-2',
                showFilters && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
              )}
            >
              <Funnel className="mr-2 h-4 w-4" aria-hidden="true" />
              Filters
            </button>
          </div>

          {/* Column Filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
              >
                {columns
                  .filter((col) => col.filterable)
                  .map((column) => (
                    <div key={column.key}>
                      <label className="mb-1 block text-sm font-medium text-foreground">
                        {column.label}
                      </label>
                      <UIInput
                        type="text"
                        placeholder={`Filter by ${column.label.toLowerCase()}...`}
                        value={filterConfig[column.key] || ''}
                        onChange={(e) => handleFilterChange(column.key, e.target.value)}
                      />
                    </div>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto" style={{ maxHeight: maxHeight }}>
        <UITable>
          {/* Header */}
          <thead className={cn(tableClasses.thead, stickyHeader && 'sticky top-0 z-10')}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={cn(
                    'px-6 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground',
                    getAlignmentClass(column.align),
                    column.sortable && 'cursor-pointer hover:bg-accent hover:text-accent-foreground'
                  )}
                  onClick={() => handleSort(column)}
                >
                  <div className="flex items-center gap-1">
                    <span>{column.label}</span>
                    {getSortIcon(column)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody className={tableClasses.tbody}>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={tableStateClasses.empty}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, index) => (
                <motion.tr
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'transition-colors hover:bg-muted/40',
                    onRowClick && 'cursor-pointer',
                    getRowClassName(row, index)
                  )}
                  onClick={() => onRowClick?.(row, index)}
                >
                  {columns.map((column) => {
                    const value = row[column.key];
                    return (
                      <td
                        key={column.key}
                        className={cn(
                          'whitespace-nowrap px-6 py-4 text-sm text-foreground',
                          getAlignmentClass(column.align)
                        )}
                      >
                        {column.render ? column.render(value, row, index) : String(value ?? '')}
                      </td>
                    );
                  })}
                </motion.tr>
              ))
            )}
          </tbody>
        </UITable>
      </div>

      {/* Pagination */}
      {paginationConfig.showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-3">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
              disabled={currentPage === 1}
              className={cn(controlButtonClasses, 'relative px-4 py-2')}
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
              disabled={currentPage === totalPages}
              className={cn(controlButtonClasses, 'relative ml-3 px-4 py-2')}
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Showing{' '}
                <span className="font-medium text-foreground">
                  {(currentPage - 1) * paginationConfig.pageSize + 1}
                </span>{' '}
                to{' '}
                <span className="font-medium text-foreground">
                  {Math.min(currentPage * paginationConfig.pageSize, processedData.length)}
                </span>{' '}
                of <span className="font-medium text-foreground">{processedData.length}</span>{' '}
                results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex -space-x-px rounded-md shadow-sm">
                <button
                  onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
                  disabled={currentPage === 1}
                  className={cn(controlButtonClasses, 'relative rounded-r-none px-2 py-2')}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>

                {/* Page numbers */}
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={cn(
                        'relative inline-flex items-center border px-4 py-2 text-sm font-medium transition-colors focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        currentPage === pageNum
                          ? 'z-10 border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                      aria-current={currentPage === pageNum ? 'page' : undefined}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={cn(controlButtonClasses, 'relative rounded-l-none px-2 py-2')}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
