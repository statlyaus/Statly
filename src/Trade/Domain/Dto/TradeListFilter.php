<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

use Statly\Trade\Domain\Enum\TradeStatus;

final readonly class TradeListFilter
{
    public function __construct(
        public ?string $leagueId = null,
        public ?string $userId = null,
        public ?TradeStatus $status = null
    ) {}
}
