<?php

declare(strict_types=1);

namespace Statly\Trade\Infrastructure\Repository;

use PDO;
use Statly\Trade\Domain\Contract\TradeRepositoryInterface;
use Statly\Trade\Domain\Dto\TradeCreateRequest;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Dto\TradeIdempotencyRecord;
use Statly\Trade\Domain\Dto\TradeItemInput;
use Statly\Trade\Domain\Dto\TradeListFilter;
use Statly\Trade\Domain\Dto\TradeListResult;
use Statly\Trade\Domain\Dto\TradeSummary;
use Statly\Trade\Domain\Enum\TradeStatus;

final class DbTradeRepository implements TradeRepositoryInterface
{
    public function __construct(private readonly PDO $connection) {}

    public function create(TradeCreateRequest $request, TradeStatus $status): TradeDetails
    {
        $tradeId = $this->newUuid();

        $stmt = $this->connection->prepare(
            'INSERT INTO trades (
                id,
                league_id,
                round_id,
                proposer_user_id,
                recipient_user_id,
                status,
                request_id,
                parent_trade_id,
                request_payload_hash,
                created_at
            ) VALUES (
                :id,
                :league_id,
                :round_id,
                :proposer_user_id,
                :recipient_user_id,
                :status,
                :request_id,
                :parent_trade_id,
                :request_payload_hash,
                NOW()
            )'
        );

        $stmt->execute([
            'id' => $tradeId,
            'league_id' => $request->leagueId,
            'round_id' => $request->roundId,
            'proposer_user_id' => $request->proposerUserId,
            'recipient_user_id' => $request->recipientUserId,
            'status' => $status->value,
            'request_id' => $request->requestId,
            'parent_trade_id' => $request->parentTradeId,
            'request_payload_hash' => $this->computeRequestPayloadHash($request),
        ]);

        return new TradeDetails(
            $tradeId,
            $request->leagueId,
            $request->roundId,
            $request->proposerUserId,
            $request->recipientUserId,
            $status,
            $request->items,
            []
        );
    }

    public function findById(string $tradeId): ?TradeDetails
    {
        return $this->findByIdInternal($tradeId, false);
    }

    public function findByIdForUpdate(string $tradeId): ?TradeDetails
    {
        return $this->findByIdInternal($tradeId, true);
    }

    public function findIdempotencyRecordByRequestId(string $requestId, string $proposerUserId): ?TradeIdempotencyRecord
    {
        $stmt = $this->connection->prepare(
            'SELECT id, status, request_payload_hash
             FROM trades
             WHERE request_id = :request_id AND proposer_user_id = :proposer_user_id
             LIMIT 1'
        );

        $stmt->execute([
            'request_id' => $requestId,
            'proposer_user_id' => $proposerUserId,
        ]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }

        return new TradeIdempotencyRecord(
            $row['id'],
            TradeStatus::from($row['status']),
            $row['request_payload_hash']
        );
    }

    public function list(TradeListFilter $filter): TradeListResult
    {
        $conditions = [];
        $params = [];

        if ($filter->leagueId !== null) {
            $conditions[] = 'league_id = :league_id';
            $params['league_id'] = $filter->leagueId;
        }

        if ($filter->userId !== null) {
            $conditions[] = '(proposer_user_id = :user_id OR recipient_user_id = :user_id)';
            $params['user_id'] = $filter->userId;
        }

        if ($filter->status !== null) {
            $conditions[] = 'status = :status';
            $params['status'] = $filter->status->value;
        }

        $where = '';
        if ($conditions !== []) {
            $where = 'WHERE ' . implode(' AND ', $conditions);
        }

        $stmt = $this->connection->prepare(
            "SELECT id, league_id, round_id, proposer_user_id, recipient_user_id, status, created_at
             FROM trades
             {$where}
             ORDER BY created_at DESC"
        );

        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $trades = [];
        foreach ($rows as $row) {
            $trades[] = new TradeSummary(
                $row['id'],
                $row['league_id'],
                $row['round_id'],
                $row['proposer_user_id'],
                $row['recipient_user_id'],
                TradeStatus::from($row['status']),
                (string) $row['created_at']
            );
        }

        return new TradeListResult($trades);
    }

    public function updateStatus(string $tradeId, TradeStatus $status): void
    {
        $setExecutedAt = $status === TradeStatus::EXECUTED ? ', executed_at = NOW()' : '';

        $stmt = $this->connection->prepare(
            "UPDATE trades SET status = :status{$setExecutedAt} WHERE id = :id"
        );

        $stmt->execute([
            'status' => $status->value,
            'id' => $tradeId,
        ]);
    }

    public function setSupersededBy(string $tradeId, string $supersededByTradeId): void
    {
        $stmt = $this->connection->prepare(
            'UPDATE trades SET superseded_by_trade_id = :superseded WHERE id = :id'
        );

        $stmt->execute([
            'superseded' => $supersededByTradeId,
            'id' => $tradeId,
        ]);
    }

    private function findByIdInternal(string $tradeId, bool $forUpdate): ?TradeDetails
    {
        $sql = 'SELECT id, league_id, round_id, proposer_user_id, recipient_user_id, status
                FROM trades
                WHERE id = :id';

        if ($forUpdate) {
            $sql .= ' FOR UPDATE';
        }

        $stmt = $this->connection->prepare($sql);
        $stmt->execute(['id' => $tradeId]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }

        $items = $this->fetchItems($row['id']);

        return new TradeDetails(
            $row['id'],
            $row['league_id'],
            $row['round_id'],
            $row['proposer_user_id'],
            $row['recipient_user_id'],
            TradeStatus::from($row['status']),
            $items,
            []
        );
    }

    /**
     * @return list<TradeItemInput>
     */
    private function fetchItems(string $tradeId): array
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

    private function computeRequestPayloadHash(TradeCreateRequest $request): string
    {
        $items = array_map(
            static fn (TradeItemInput $item): array => [
                'from' => $item->fromUserId,
                'to' => $item->toUserId,
                'player' => $item->playerId,
            ],
            $request->items
        );

        usort(
            $items,
            static fn (array $a, array $b): int => [$a['from'], $a['to'], $a['player']]
                <=> [$b['from'], $b['to'], $b['player']]
        );

        $ruleVersions = $request->ruleVersions;
        sort($ruleVersions);

        $payload = [
            'leagueId' => $request->leagueId,
            'roundId' => $request->roundId,
            'proposerUserId' => $request->proposerUserId,
            'recipientUserId' => $request->recipientUserId,
            'parentTradeId' => $request->parentTradeId,
            'note' => $request->note,
            'items' => $items,
            'ruleVersions' => $ruleVersions,
        ];

        return hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES));
    }
}
