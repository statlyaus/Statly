<?php

declare(strict_types=1);

namespace Statly\Trade\Infrastructure\Repository;

use PDO;
use Statly\Trade\Domain\Contract\TradeItemRepositoryInterface;
use Statly\Trade\Domain\Dto\TradeItemInput;

final class DbTradeItemRepository implements TradeItemRepositoryInterface
{
    public function __construct(private readonly PDO $connection) {}

    public function addItems(string $tradeId, array $items): void
    {
        if ($items === []) {
            return;
        }

        $stmt = $this->connection->prepare(
            'INSERT INTO trade_items (id, trade_id, from_user_id, to_user_id, player_id, created_at)
             VALUES (:id, :trade_id, :from_user_id, :to_user_id, :player_id, CURRENT_TIMESTAMP)'
        );

        foreach ($items as $item) {
            $stmt->execute([
                'id' => $this->newUuid(),
                'trade_id' => $tradeId,
                'from_user_id' => $item->fromUserId,
                'to_user_id' => $item->toUserId,
                'player_id' => $item->playerId,
            ]);
        }
    }

    public function listItems(string $tradeId): array
    {
        $stmt = $this->connection->prepare(
            'SELECT from_user_id, to_user_id, player_id FROM trade_items WHERE trade_id = :trade_id'
        );

        $stmt->execute(['trade_id' => $tradeId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $items = [];
        foreach ($rows as $row) {
            $items[] = new TradeItemInput(
                $row['from_user_id'],
                $row['to_user_id'],
                $row['player_id']
            );
        }

        return $items;
    }

    private function newUuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
