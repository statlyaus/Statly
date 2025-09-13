'use client';

import React, { useState, useMemo } from 'react';
import type { ReactNode } from 'react';

import {
  ChevronUpIcon,
  ChevronDownIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

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
      return <ChevronUpIcon className="w-4 h-4" />;
    }
    if (isActive && direction === 'desc') {
      return <ChevronDownIcon className="w-4 h-4" />;
    }
    return <ChevronUpIcon className="w-4 h-4 opacity-30" />;
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
      <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Search and Filter Controls */}
      {searchable && (
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between gap-4">
            {/* Global Search */}
            {globalSearch && (
              <div className="flex-1 relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={globalSearchTerm}
                  onChange={(e) => handleGlobalSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center px-3 py-2 border rounded-lg transition-colors ${
                showFilters
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              <FunnelIcon className="w-4 h-4 mr-2" />
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
                className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {columns
                  .filter((col) => col.filterable)
                  .map((column) => (
                    <div key={column.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {column.label}
                      </label>
                      <input
                        type="text"
                        placeholder={`Filter by ${column.label.toLowerCase()}...`}
                        value={filterConfig[column.key] || ''}
                        onChange={(e) => handleFilterChange(column.key, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
        <table className="w-full">
          {/* Header */}
          <thead className={`bg-gray-50 ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={`px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${
                    column.align === 'center'
                      ? 'text-center'
                      : column.align === 'right'
                        ? 'text-right'
                        : 'text-left'
                  } ${column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
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
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-8 text-center text-gray-500">
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
                  className={`hover:bg-gray-50 transition-colors ${
                    onRowClick ? 'cursor-pointer' : ''
                  } ${getRowClassName(row, index)}`}
                  onClick={() => onRowClick?.(row, index)}
                >
                  {columns.map((column) => {
                    const value = row[column.key];
                    return (
                      <td
                        key={column.key}
                        className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 ${
                          column.align === 'center'
                            ? 'text-center'
                            : column.align === 'right'
                              ? 'text-right'
                              : 'text-left'
                        }`}
                      >
                        {column.render ? column.render(value, row, index) : String(value ?? '')}
                      </td>
                    );
                  })}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {paginationConfig.showPagination && totalPages > 1 && (
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing{' '}
                <span className="font-medium">
                  {(currentPage - 1) * paginationConfig.pageSize + 1}
                </span>{' '}
                to{' '}
                <span className="font-medium">
                  {Math.min(currentPage * paginationConfig.pageSize, processedData.length)}
                </span>{' '}
                of <span className="font-medium">{processedData.length}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                <button
                  onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeftIcon className="h-5 w-5" />
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
                      className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                        currentPage === pageNum
                          ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRightIcon className="h-5 w-5" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
