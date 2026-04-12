<?php

declare(strict_types=1);

namespace Statly\Trade\Infrastructure\Transaction;

use PDO;
use Statly\Trade\Application\Contract\TransactionManagerInterface;
use Throwable;

final class PdoTransactionManager implements TransactionManagerInterface
{
    public function __construct(private readonly PDO $connection) {}

    public function run(callable $fn): mixed
    {
        $this->connection->beginTransaction();

        try {
            $result = $fn();
            $this->connection->commit();

            return $result;
        } catch (Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }

            throw $exception;
        }
    }
}
