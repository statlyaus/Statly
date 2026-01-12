<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Dto;

final readonly class TradeCreateRequest
{
    /**
     * @param list<TradeItemInput> $items
     * @param list<string> $ruleVersions
     */
    public function __construct(
        public string $requestId,
        public string $leagueId,
        public ?string $roundId,
        public string $proposerUserId,
        public string $recipientUserId,
        public array $items,
        public ?string $parentTradeId = null,
        public ?string $note = null,
        public array $ruleVersions = []
    ) {}
}
