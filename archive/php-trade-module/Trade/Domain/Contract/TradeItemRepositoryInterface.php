<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

use Statly\Trade\Domain\Dto\TradeItemInput;

interface TradeItemRepositoryInterface
{
    /**
     * @param list<TradeItemInput> $items
     */
    public function addItems(string $tradeId, array $items): void;

    /**
     * @return list<TradeItemInput>
     */
    public function listItems(string $tradeId): array;
}
