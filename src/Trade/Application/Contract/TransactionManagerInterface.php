<?php

declare(strict_types=1);

namespace Statly\Trade\Application\Contract;

interface TransactionManagerInterface
{
    /**
     * Runs the callable in a single DB transaction.
     * Implementations MUST rollback on any thrown exception and rethrow it.
     *
     * @template T
     * @param callable(): T $fn
     * @return T
     * @throws \Throwable
     */
    public function run(callable $fn): mixed;
}
