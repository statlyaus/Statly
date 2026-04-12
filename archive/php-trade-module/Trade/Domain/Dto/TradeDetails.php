<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

use Statly\Trade\Domain\Enum\TradeStatus;

final readonly class TradeDetails
{
    /**
     * @param list<TradeItemInput> $items
     * @param list<TradeAuditEntry> $audit
     */
    public function __construct(
        public string $tradeId,
        public string $leagueId,
        public ?string $roundId,
        public string $proposerUserId,
        public string $recipientUserId,
        public TradeStatus $status,
        public array $items,
        public array $audit
    ) {}
}
