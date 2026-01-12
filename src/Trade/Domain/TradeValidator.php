<?php

declare(strict_types=1);

namespace Statly\Trade\Domain;

use Statly\Trade\Domain\Contract\TradeValidatorInterface;
use Statly\Trade\Domain\Dto\TradeCreateRequest;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Enum\TradeStatus;
use Statly\Trade\Domain\Exception\InvalidTradeStateException;
use Statly\Trade\Domain\Exception\UnauthorizedTradeActionException;

final class TradeValidator implements TradeValidatorInterface
{
    public function validateProposal(TradeCreateRequest $request): void
    {
        // Pure validator; persistence-level checks handled elsewhere.
    }

    public function validateAccept(TradeDetails $trade, string $actorUserId): void
    {
        if ($actorUserId !== $trade->recipientUserId) {
            throw new UnauthorizedTradeActionException();
        }

        $this->assertTransition($trade->status, TradeStatus::EXECUTED);
    }

    public function validateDecline(TradeDetails $trade, string $actorUserId): void
    {
        if ($actorUserId !== $trade->recipientUserId) {
            throw new UnauthorizedTradeActionException();
        }

        $this->assertTransition($trade->status, TradeStatus::DECLINED);
    }

    public function validateCancel(TradeDetails $trade, string $actorUserId): void
    {
        if ($actorUserId !== $trade->proposerUserId) {
            throw new UnauthorizedTradeActionException();
        }

        $this->assertTransition($trade->status, TradeStatus::CANCELLED);
    }

    public function assertTransition(TradeStatus $fromStatus, TradeStatus $toStatus): void
    {
        if (!$this->isAllowedTransition($fromStatus, $toStatus)) {
            throw new InvalidTradeStateException();
        }
    }

    private function isAllowedTransition(TradeStatus $fromStatus, TradeStatus $toStatus): bool
    {
        return match ($fromStatus) {
            TradeStatus::PROPOSED => in_array(
                $toStatus,
                [
                    TradeStatus::EXECUTED,
                    TradeStatus::DECLINED,
                    TradeStatus::CANCELLED,
                    TradeStatus::SUPERSEDED,
                    TradeStatus::EXPIRED,
                ],
                true
            ),
            default => false,
        };
    }
}
