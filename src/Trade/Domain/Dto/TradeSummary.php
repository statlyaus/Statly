<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

use Statly\Trade\Domain\Enum\TradeStatus;

final readonly class TradeSummary
{
    public function __construct(
        public string $tradeId,
        public string $leagueId,
        public ?string $roundId,
        public string $proposerUserId,
        public string $recipientUserId,
        public TradeStatus $status,
        public string $createdAt
    ) {}
}
