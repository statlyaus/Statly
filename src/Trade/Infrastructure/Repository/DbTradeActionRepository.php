<?php

declare(strict_types=1);

namespace Statly\Trade\Infrastructure\Repository;

use PDO;
use PDOException;
use Statly\Trade\Domain\Contract\TradeActionRepositoryInterface;

final class DbTradeActionRepository implements TradeActionRepositoryInterface
{
    public function __construct(private readonly PDO $connection) {}

    public function recordAction(
        string $tradeId,
        string $action,
        string $requestId,
        string $actorUserId
    ): bool {
        $stmt = $this->connection->prepare(
            'INSERT INTO trade_actions (id, trade_id, action, request_id, actor_user_id, created_at)
             VALUES (:id, :trade_id, :action, :request_id, :actor_user_id, NOW())'
        );

        try {
            $stmt->execute([
                'id' => $this->newUuid(),
                'trade_id' => $tradeId,
                'action' => $action,
                'request_id' => $requestId,
                'actor_user_id' => $actorUserId,
            ]);
        } catch (PDOException $exception) {
            if ($this->isUniqueViolation($exception)) {
                return false;
            }

            throw $exception;
        }

        return true;
    }

    private function isUniqueViolation(PDOException $exception): bool
    {
        return $exception->getCode() === '23000';
    }

    private function newUuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
