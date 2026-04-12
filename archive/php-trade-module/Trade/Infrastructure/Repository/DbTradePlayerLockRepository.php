<?php

declare(strict_types=1);

namespace Statly\Trade\Infrastructure\Repository;

use PDO;
use Statly\Trade\Domain\Contract\TradePlayerLockRepositoryInterface;

final class DbTradePlayerLockRepository implements TradePlayerLockRepositoryInterface
{
    public function __construct(private readonly PDO $connection) {}

    public function ensureLocks(string $tradeId, array $playerIds): void
    {
        if ($playerIds === []) {
            return;
        }

        $stmt = $this->connection->prepare(
            'INSERT INTO trade_player_locks (player_id, trade_id, created_at)
             VALUES (:player_id, :trade_id, NOW())
             ON CONFLICT (player_id) DO NOTHING'
        );

        foreach ($playerIds as $playerId) {
            $stmt->execute([
                'player_id' => $playerId,
                'trade_id' => $tradeId,
            ]);
        }
    }

    public function getLocks(array $playerIds): array
    {
        if ($playerIds === []) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($playerIds), '?'));
        $stmt = $this->connection->prepare(
            "SELECT player_id, trade_id FROM trade_player_locks WHERE player_id IN ({$placeholders})"
        );

        $stmt->execute(array_values($playerIds));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $locks = [];
        foreach ($rows as $row) {
            $locks[$row['player_id']] = $row['trade_id'];
        }

        return $locks;
    }

    public function transferLocks(string $fromTradeId, string $toTradeId, array $playerIds): void
    {
        if ($playerIds === []) {
            return;
        }

        $placeholders = implode(', ', array_fill(0, count($playerIds), '?'));
        $sql = "UPDATE trade_player_locks
                SET trade_id = ?
                WHERE trade_id = ? AND player_id IN ({$placeholders})";
        $params = array_merge([$toTradeId, $fromTradeId], array_values($playerIds));

        $stmt = $this->connection->prepare($sql);
        $stmt->execute($params);
    }

    public function releaseLocksForPlayers(string $tradeId, array $playerIds): void
    {
        if ($playerIds === []) {
            return;
        }

        $placeholders = implode(', ', array_fill(0, count($playerIds), '?'));
        $sql = "DELETE FROM trade_player_locks WHERE trade_id = ? AND player_id IN ({$placeholders})";
        $params = array_merge([$tradeId], array_values($playerIds));

        $stmt = $this->connection->prepare($sql);
        $stmt->execute($params);
    }

    public function releaseLocks(string $tradeId): void
    {
        $stmt = $this->connection->prepare(
            'DELETE FROM trade_player_locks WHERE trade_id = :trade_id'
        );

        $stmt->execute(['trade_id' => $tradeId]);
    }
}
